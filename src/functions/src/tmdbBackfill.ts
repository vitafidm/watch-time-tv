import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { tmdbEnrichFlow } from "./flows/tmdb-enrich-flow";

if (!admin.apps.length) admin.initializeApp();
const corsHandler = cors({ origin: true });

type ItemMovie = {
  mediaId: string;
  type: "movie";
  title: string;
  year?: number;
};

type ItemEpisode = {
  mediaId: string;
  type: "episode";
  title: string;   // show title
  season: number;
  episode: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function isNum(n: any): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

// Very forgiving filename -> showTitle fallback
function inferShowTitleFromFilename(name: string): string | null {
  if (!name) return null;
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const m =
    base.match(/^(.*?)\s*[\.\-\s_]*\(?\d{4}\)?\s*[\-\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)\s*[\-\.\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)\s*-\s*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)[\.\s_]+S\d{1,2}E\d{1,2}/);
  const raw = (m?.[1] || base).trim();
  if (!raw) return null;
  return raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

export default functions
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
        const b = (req.body || {}) as any;

        const typeParam = (b.type || q.type || "all") as "movie" | "episode" | "all";
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
        let firstErrorMessage: string | null = null;

        const preview: any[] = [];

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
            query = query.startAfter(
              admin.firestore.Timestamp.fromMillis(ms),
              docId
            );
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

        type Media = FirebaseFirestore.DocumentData & {
          type?: string;
          tmdbId?: any;
          year?: number;
          season?: number;
          seasonNumber?: number;
          episode?: number;
          episodeNumber?: number;
          normalizedTitle?: string | null;
          title?: string | null;
          filename?: string | null;
          showRef?: string | null;
          showTitle?: string | null;
        };

        const items: Array<ItemMovie | ItemEpisode> = [];

        for (const d of snap.docs) {
          const m = (d.data() || {}) as Media;

          if (typeParam !== "all" && m.type !== typeParam) continue;

          const tmdbIdOk = typeof m.tmdbId === "number" && !Number.isNaN(m.tmdbId);
          if (tmdbIdOk) {
            skipped++;
            continue;
          }

          if (m.type === "movie") {
            const title = (m.normalizedTitle || m.title || m.filename || "").trim();
            if (!title) {
              if (debug) preview.push({ mediaId: d.id, reason: "no_title" });
              continue;
            }
            const year = isNum(m.year) ? m.year : undefined;
            items.push({ mediaId: d.id, type: "movie", title, year });
          } else if (m.type === "episode") {
            const season =
              isNum(m.season) ? m.season : isNum(m.seasonNumber) ? m.seasonNumber : undefined;
            const episode =
              isNum(m.episode) ? m.episode : isNum(m.episodeNumber) ? m.episodeNumber : undefined;

            let showTitle = (m.showTitle || null) as string | null;

            if (!showTitle && m.showRef && typeof m.showRef === "string") {
              try {
                const showSnap = await db.doc(m.showRef).get();
                if (showSnap.exists) {
                  const s = showSnap.data() || {};
                  showTitle = s.normalizedTitle || s.title || s.filename || s.name || null;
                }
              } catch { /* ignore */ }
            }

            if (!showTitle) {
              const raw = (m.filename || m.title || "").trim();
              showTitle = inferShowTitleFromFilename(raw);
            }

            if (showTitle && isNum(season) && isNum(episode)) {
              items.push({ mediaId: d.id, type: "episode", title: showTitle, season, episode });
            } else if (debug) {
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
            const r = await tmdbEnrichFlow(uid, { items: items as any });
            const results = (r?.results || []) as Array<{
              mediaId: string;
              status: "enriched" | "not_found" | "error" | "skipped";
            }>;
            for (const row of results) {
              if (row.status === "enriched") enriched++;
              else if (row.status === "not_found") notFound++;
              else if (row.status === "skipped") skipped++;
              else errors++;
            }
          } catch (e: any) {
            functions.logger.warn("Enrichment chunk failed", {
              error: (e as Error).message,
              count: items.length,
            });
            errors += items.length;
            firstErrorMessage = (e as Error)?.message || String(e);
          }
        }

        // Compute nextCursor from the LAST doc in this (small) page
        const last = snap.docs[snap.docs.length - 1];
        const lastTs = last?.get("updatedAt");
        const tsMs =
          lastTs && typeof lastTs.toMillis === "function" ? lastTs.toMillis() : 0;
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

      } catch (e: any) {
        functions.logger.error("tmdbBackfillMissing fatal", e);
        return res.status(500).json({
          error: { status: "INTERNAL", message: e?.message || "Internal error" },
        });
      }
    });
  });
