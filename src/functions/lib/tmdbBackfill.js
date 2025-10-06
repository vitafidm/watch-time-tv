"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const tmdb_enrich_flow_1 = require("./flows/tmdb-enrich-flow");
if (!admin.apps.length)
    admin.initializeApp();
const corsHandler = (0, cors_1.default)({ origin: true });
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
function isNum(n) {
    return typeof n === "number" && Number.isFinite(n);
}
// Very forgiving filename -> showTitle fallback
function inferShowTitleFromFilename(name) {
    if (!name)
        return null;
    const base = name.replace(/\.[a-z0-9]+$/i, "");
    const m = base.match(/^(.*?)\s*[\.\-\s_]*\(?\d{4}\)?\s*[\-\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)\s*[\-\.\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)\s*-\s*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)[\.\s_]+S\d{1,2}E\d{1,2}/);
    const raw = (m?.[1] || base).trim();
    if (!raw)
        return null;
    return raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}
exports.default = functions
    .runWith({ timeoutSeconds: 540, memory: "1GB" })
    .https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" } });
            }
            // Auth
            const header = req.headers.authorization || "";
            if (!header.startsWith("Bearer ")) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Missing Authorization: Bearer <ID_TOKEN>" } });
            }
            const idToken = header.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Invalid ID token" } });
            }
            const uid = decoded.uid;
            const db = admin.firestore();
            const q = req.query || {};
            const b = (req.body || {});
            const typeParam = (b.type || q.type || "all");
            const limit = clamp(parseInt(String(b.limit ?? q.limit ?? "500"), 10) || 500, 1, 1000);
            const batchSize = clamp(parseInt(String(b.batchSize ?? q.batchSize ?? "50"), 10) || 50, 1, 50);
            // 👇 Make each request short: handle at most ONE chunk by capping the page size
            const effectiveLimit = Math.min(limit, batchSize);
            const debug = String(b.debug ?? q.debug ?? "false").toLowerCase() === "true";
            let cursor = String(b.cursor ?? q.cursor ?? "");
            let scanned = 0;
            let candidates = 0;
            let sentToEnrich = 0;
            let enriched = 0;
            let notFound = 0;
            let errors = 0;
            let skipped = 0;
            let firstErrorMessage = null;
            const preview = [];
            // Read just one small page (<= batchSize)
            const coll = db.collection(`users/${uid}/media`);
            let query = coll
                .where("tmdbId", "==", null)
                .orderBy("updatedAt", "desc")
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(effectiveLimit);
            if (cursor) {
                const [msStr, docId] = cursor.split("|");
                const ms = Number(msStr);
                if (Number.isFinite(ms) && docId) {
                    query = query.startAfter(admin.firestore.Timestamp.fromMillis(ms), docId);
                }
            }
            const snap = await query.get();
            if (snap.empty) {
                // nothing left
                return res.status(200).json({
                    scanned: 0,
                    candidates: 0,
                    sentToEnrich: 0,
                    enriched: 0,
                    notFound: 0,
                    skipped: 0,
                    errors: 0,
                    nextCursor: null,
                    retryAfterMs: 11000,
                    ...(debug ? { preview } : {}),
                    info: "No documents found."
                });
            }
            scanned = snap.size;
            const items = [];
            for (const d of snap.docs) {
                const m = (d.data() || {});
                if (typeParam !== "all" && m.type !== typeParam)
                    continue;
                const tmdbIdOk = typeof m.tmdbId === "number" && !Number.isNaN(m.tmdbId);
                if (tmdbIdOk) {
                    skipped++;
                    continue;
                }
                if (m.type === "movie") {
                    const title = (m.normalizedTitle || m.title || m.filename || "").trim();
                    if (!title) {
                        if (debug)
                            preview.push({ mediaId: d.id, reason: "no_title" });
                        continue;
                    }
                    const year = isNum(m.year) ? m.year : undefined;
                    items.push({ mediaId: d.id, type: "movie", title, year });
                }
                else if (m.type === "episode") {
                    const season = isNum(m.season) ? m.season : isNum(m.seasonNumber) ? m.seasonNumber : undefined;
                    const episode = isNum(m.episode) ? m.episode : isNum(m.episodeNumber) ? m.episodeNumber : undefined;
                    let showTitle = (m.showTitle || null);
                    if (!showTitle && m.showRef && typeof m.showRef === "string") {
                        try {
                            const showSnap = await db.doc(m.showRef).get();
                            if (showSnap.exists) {
                                const s = showSnap.data() || {};
                                showTitle = s.normalizedTitle || s.title || s.filename || s.name || null;
                            }
                        }
                        catch { /* ignore */ }
                    }
                    if (!showTitle) {
                        const raw = (m.filename || m.title || "").trim();
                        showTitle = inferShowTitleFromFilename(raw);
                    }
                    if (showTitle && isNum(season) && isNum(episode)) {
                        items.push({ mediaId: d.id, type: "episode", title: showTitle, season, episode });
                    }
                    else if (debug) {
                        preview.push({
                            mediaId: d.id,
                            reason: "insufficient_episode_fields",
                            have: { showTitle, season, episode, filename: m.filename, title: m.title },
                        });
                    }
                }
            }
            candidates = items.length;
            // Process at most ONE chunk (<= batchSize == effectiveLimit)
            if (items.length) {
                try {
                    sentToEnrich = items.length;
                    const r = await (0, tmdb_enrich_flow_1.tmdbEnrichFlow)(uid, { items: items });
                    const results = (r?.results || []);
                    for (const row of results) {
                        if (row.status === "enriched")
                            enriched++;
                        else if (row.status === "not_found")
                            notFound++;
                        else if (row.status === "skipped")
                            skipped++;
                        else
                            errors++;
                    }
                }
                catch (e) {
                    functions.logger.warn("Enrichment chunk failed", {
                        error: e.message,
                        count: items.length,
                    });
                    errors += items.length;
                    firstErrorMessage = e?.message || String(e);
                }
            }
            // Compute nextCursor from the LAST doc in this (small) page
            const last = snap.docs[snap.docs.length - 1];
            const lastTs = last?.get("updatedAt");
            const tsMs = lastTs && typeof lastTs.toMillis === "function" ? lastTs.toMillis() : 0;
            cursor = `${tsMs}|${last.id}`;
            // Respect current cooldown (let UI wait appropriately)
            const rateRef = db.doc(`users/${uid}/integrations_meta/tmdbRateLimit`);
            const rateSnap = await rateRef.get();
            let retryAfterMs = 11000;
            if (rateSnap.exists) {
                const until = rateSnap.get("rateLimitedUntil")?.toMillis();
                if (until && until > Date.now()) {
                    retryAfterMs = Math.max(11000, until - Date.now() + 500);
                }
            }
            return res.status(200).json({
                scanned,
                candidates,
                sentToEnrich,
                enriched,
                notFound,
                skipped,
                errors,
                nextCursor: cursor,
                retryAfterMs,
                ...(debug ? { preview, firstErrorMessage } : {}),
            });
        }
        catch (e) {
            functions.logger.error("tmdbBackfillMissing fatal", e);
            return res.status(500).json({
                error: { status: "INTERNAL", message: e?.message || "Internal error" },
            });
        }
    });
});
