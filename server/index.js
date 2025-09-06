// Minimal NAS backend: /health, /scan, /items, /stream, plus /push and /sync to Firebase agentIngest
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

// ---------- Env & constants ----------
const PORT = Number(process.env.PORT || 4010);
const MOVIES_ROOT = process.env.MOVIES_PATH || "/media/Movies";
const TV_ROOT = process.env.TV_PATH || "/media/TV";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const AGENT_INGEST_URL = process.env.AGENT_INGEST_URL || "";
const AGENT_API_KEY = process.env.AGENT_API_KEY || "";

// Push batching limits (can override via env)
const PUSH_MAX_ITEMS = Number(process.env.PUSH_MAX_ITEMS || 500);
const PUSH_MAX_BODY_BYTES = Number(process.env.PUSH_MAX_BODY_BYTES || 5_000_000); // ~5 MB

const DATA_DIR = "/app/.data";
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm"]);

// ---------- Utils ----------
function guessMime(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".avi") return "video/x-msvideo";
  return "application/octet-stream";
}

async function ensureDataDir() {
  try { await fsp.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

function safeWithin(allowedRoot, p) {
  const full = path.resolve(p);
  const root = path.resolve(allowedRoot);
  return full.startsWith(root + path.sep);
}

async function walk(dir, type, items) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, type, items);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        const title = path.basename(e.name, ext);
        items.push({ id: Buffer.from(full).toString("base64url"), type, title, path: full });
      }
    }
  }
}

async function fileSize(p) {
  try { const s = await fsp.stat(p); return s.size; } catch { return null; }
}

async function buildCatalog() {
  const items = [];
  await walk(MOVIES_ROOT, "movie", items);
  await walk(TV_ROOT, "tv", items);
  const updatedAt = Date.now();
  await ensureDataDir();
  await fsp.writeFile(CATALOG_PATH, JSON.stringify({ updatedAt, items }), "utf8");
  return { updatedAt, items };
}

async function readCatalog() {
  try {
    const buf = await fsp.readFile(CATALOG_PATH, "utf8");
    return JSON.parse(buf);
  } catch {
    return { updatedAt: 0, items: [] };
  }
}

function sendJSON(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}
function notFound(res) {
  res.writeHead(404, { "Access-Control-Allow-Origin": CORS_ORIGIN });
  res.end();
}
function bad(res, msg = "Bad Request") {
  sendJSON(res, { error: msg }, 400);
}
function mediaIdFromPath(p) {
  const b64 = Buffer.from(p).toString("base64url");
  return crypto.createHash("sha1").update(b64).digest("hex");
}

async function postJSON(urlStr, headers, json) {
  const r = await fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(json),
  });
  const t = await r.text();
  let body = null;
  try { body = t ? JSON.parse(t) : null; } catch { body = { raw: t }; }
  return { ok: r.ok, status: r.status, body };
}

// ---------- Filename parsers (NEW) ----------
function parseSeasonEpisode(filename) {
  // Matches S01E02 / s01e02
  let m = filename.match(/s(\d{1,2})e(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  // Matches 1x02
  m = filename.match(/(\d{1,2})x(\d{1,3})/);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  return {};
}

function parseYear(filename) {
  // Common 4-digit year pattern
  const m = filename.match(/(?:^|[\.\s\-_\(])((19|20)\d{2})(?:[\.\s\-_\)])?/);
  return m ? parseInt(m[1], 10) : undefined;
}

// ---------- Batching helpers ----------
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function bodyBytesForItems(items) {
  const payload = JSON.stringify({ items });
  return Buffer.byteLength(payload, "utf8");
}

// Recursively split any chunk whose JSON body would exceed maxBytes.
// Returns an array of size-safe chunks.
function splitByMaxBody(items, maxBytes) {
  let chunks = [items];
  let changed = true;
  while (changed) {
    changed = false;
    const next = [];
    for (const c of chunks) {
      if (bodyBytesForItems(c) > maxBytes && c.length > 1) {
        const mid = Math.ceil(c.length / 2);
        next.push(c.slice(0, mid), c.slice(mid));
        changed = true;
      } else {
        next.push(c);
      }
    }
    chunks = next;
  }
  return chunks;
}

// ---------- HTTP server ----------
const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  if (req.method === "GET" && pathname === "/health") {
    return sendJSON(res, {
      ok: true,
      movies: MOVIES_ROOT,
      tv: TV_ROOT,
      ingestConfigured: !!(AGENT_INGEST_URL && AGENT_API_KEY),
    });
  }

  if (req.method === "POST" && pathname === "/scan") {
    try {
      const cat = await buildCatalog();
      return sendJSON(res, { ok: true, ...cat });
    } catch (e) {
      return bad(res, e?.message || "Scan failed");
    }
  }

  if (req.method === "GET" && pathname === "/items") {
    const cat = await readCatalog();
    return sendJSON(res, cat);
  }

  if (req.method === "GET" && pathname === "/stream") {
    const p = query.path;
    if (!p) return bad(res, "Missing ?path");
    const allowed = safeWithin(MOVIES_ROOT, p) || safeWithin(TV_ROOT, p);
    if (!allowed) return bad(res, "Path not allowed");
    try {
      const stat = await fsp.stat(p);
      const range = req.headers.range;
      const mime = guessMime(p);
      if (!range) {
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": stat.size,
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": CORS_ORIGIN,
        });
        fs.createReadStream(p).pipe(res);
        return;
      }
      const [unit, bytes] = range.split("=");
      if (unit !== "bytes") return bad(res, "Invalid Range header");
      const [startStr, endStr] = bytes.split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      if (Number.isNaN(start) || start < 0 || end < start) return bad(res, "Invalid byte range");
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mime,
        "Access-Control-Allow-Origin": CORS_ORIGIN,
      });
      fs.createReadStream(p, { start, end }).pipe(res);
      return;
    } catch {
      return notFound(res);
    }
  }

  // ---------- PUSH: send catalog to Firebase agentIngest (batched + validated) ----------
  if (req.method === "POST" && pathname === "/push") {
    if (!AGENT_INGEST_URL || !AGENT_API_KEY) return bad(res, "AGENT_INGEST_URL or AGENT_API_KEY not set");
    try {
      const cat = await readCatalog();
      const raw = Array.isArray(cat.items) ? cat.items : [];

      // Build candidate items with size/duration, map "tv" -> "episode" and add season/episode or year (NEW)
      const built = await Promise.all(
        raw.map(async (it) => {
          const size = await fileSize(it.path); // may be null if missing/inaccessible
          const filename = path.basename(it.path);
          const base = {
            mediaId: mediaIdFromPath(it.path),
            title: it.title || filename,
            filename,
            path: it.path,
            type: it.type === "movie" ? "movie" : "episode",
            size: typeof size === "number" ? size : 0, // explicit number for validation
            duration: 1, // TODO: replace with ffprobe if desired; must be > 0 for backend schema
            addedAt: new Date(cat.updatedAt || Date.now()).toISOString(),
          };

          if (base.type === "episode") {
            const se = parseSeasonEpisode(filename);
            if (Number.isInteger(se.season)) base.season = se.season;
            if (Number.isInteger(se.episode)) base.episode = se.episode;
          } else if (base.type === "movie") {
            const y = parseYear(filename);
            if (Number.isInteger(y)) base.year = y;
          }

          return base;
        })
      );

      // Pre-validation: drop invalid entries and collect reasons
      const valid = [];
      const skipped = [];
      for (const it of built) {
        const hasReq =
          typeof it.title === "string" && it.title.length > 0 &&
          typeof it.filename === "string" && it.filename.length > 0 &&
          typeof it.path === "string" && it.path.length > 0 &&
          (it.type === "movie" || it.type === "episode");

        if (!hasReq) { skipped.push({ path: it.path, reason: "missing_required_fields" }); continue; }
        if (!(typeof it.size === "number" && it.size > 0)) { skipped.push({ path: it.path, reason: "size_non_positive" }); continue; }
        if (!(typeof it.duration === "number" && it.duration > 0)) { skipped.push({ path: it.path, reason: "duration_non_positive" }); continue; }
        valid.push(it);
      }

      // Chunk by count (<= PUSH_MAX_ITEMS)
      let batches = chunkArray(valid, Math.max(1, PUSH_MAX_ITEMS));
      // Further split any over-large JSON bodies to respect PUSH_MAX_BODY_BYTES
      const sizeSafeBatches = [];
      for (const b of batches) sizeSafeBatches.push(...splitByMaxBody(b, PUSH_MAX_BODY_BYTES));

      // Optional query params: allow manual slicing via /push?offset=&limit=
      const haveManualSlice = typeof query.offset !== "undefined" || typeof query.limit !== "undefined";
      let finalBatches = sizeSafeBatches;
      if (haveManualSlice) {
        const offset = Math.max(0, Number(query.offset || 0) | 0);
        const limit = Math.max(1, Number(query.limit || PUSH_MAX_ITEMS) | 0);
        const slice = valid.slice(offset, offset + limit);
        finalBatches = splitByMaxBody(slice, PUSH_MAX_BODY_BYTES);
      }

      // Post sequentially, aggregate results
      const allResults = [];
      let postedBatches = 0;

      for (const batch of finalBatches) {
        if (batch.length === 0) continue;
        const payload = { items: batch };
        const { ok, status, body } = await postJSON(
          AGENT_INGEST_URL,
          { Authorization: `Bearer ${AGENT_API_KEY}` },
          payload
        );
        allResults.push({ ok, status, body });
        postedBatches++;
        // Keep posting remaining batches even if one returns non-2xx; caller gets full summary
      }

      return sendJSON(res, {
        ok: true,
        postedBatches,
        sentItems: valid.length,
        skipped,
        results: allResults,
      });
    } catch (e) {
      return bad(res, e?.message || "Push failed");
    }
  }

  // ---------- SYNC: scan + push ----------
  if (req.method === "POST" && pathname === "/sync") {
    try {
      await buildCatalog();
      // Reuse push
      req.url = "/push";
      req.method = "POST";
      return server.emit("request", req, res);
    } catch (e) {
      return bad(res, e?.message || "Sync failed");
    }
  }

  // Fallback
  notFound(res);
});

// ---------- Start ----------
server.listen(PORT, () => {
  console.log(`media-backend listening on ${PORT}`);
  console.log(`Movies root: ${MOVIES_ROOT}`);
  console.log(`TV root: ${TV_ROOT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
  if (AGENT_INGEST_URL) console.log(`agentIngest: ${AGENT_INGEST_URL}`);
  console.log(`push enabled: ${!!(AGENT_INGEST_URL && AGENT_API_KEY)}`);
});
