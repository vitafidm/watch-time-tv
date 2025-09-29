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
  type: "episode"; // <-- must be "episode", not "tv"
  title: string;   // <-- show title goes here
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
  // strip extension
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  // common patterns: "Show.Name.S01E02", "Show Name - s01e02", "Show (2019) - S01E02 - Title"
  const m =
    base.match(/^(.*?)\s*[\.\-\s_]*\(?\d{4}\)?\s*[\-\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)\s*[\-\.\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)\s*-\s*[sS]\d{1,2}[eE]\d{1,2}/) ||
    base.match(/^(.*?)[\.\s_]+S\d{1,2}E\d{1,2}/);

  const raw = (m?.[1] || base).trim();
  if (!raw) return null;
  // de-dot/de-slug
  return raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

export default functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
      try {
        if (req.method !== "POST") {
          return res
            .status(405)
            .json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" } });
        }

        // Auth (Firebase ID token from your Mac curl)
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) {
          return res.status(401).json({
            error: {
              status: "UNAUTHENTICATED",
              message: "Missing Authorization: Bearer <ID_TOKEN>",
            },
          });
        }
        const idToken = header.substring(7);
        const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
        if (!decoded?.uid) {
          return res
            .status(401)
            .json({ error: { status: "UNAUTHENTICATED", message: "Invalid ID token" } });
        }
        const uid = decoded.uid;

        const db = admin.firestore();
        const q = req.query || {};
        const b = (req.body || {}) as any;

        const typeParam = (b.type || q.type || "all") as "movie" | "episode" | "all";
        const limit = clamp(
          parseInt(String(b.limit ?? q.limit ?? "500"), 10) || 500,
          1,
          1000
        ); // docs per Firestore page

        // HARD CAP at 50 because tmdbEnrich only accepts up to 50 items per call
        const batchSize = clamp(
          parseInt(String(b.batchSize ?? q.batchSize ?? "50"), 10) || 50,
          1,
          50
        );

        const processAll =
          String(b.processAll ?? q.processAll ?? "false").toLowerCase() === "true";
        const debug =
          String(b.debug ?? q.debug ?? "false").toLowerCase() === "true";

        let cursor = String(b.cursor ?? q.cursor ?? "");
        const started = Date.now();
        const SOFT_DEADLINE_MS = 470_000; // ~7.8 min, under 540s limit

        let scanned = 0;
        let candidates = 0;
        let sentToEnrich = 0;
        let enriched = 0;
        let notFound = 0;
        let errors = 0;
        let skipped = 0;

        const preview: any[] = [];

        const coll = db.collection(`users/${uid}/media`);

        while (true) {
          let query = coll
            .orderBy("updatedAt", "desc")
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(limit);

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
            cursor = "";
            break;
          }

          scanned += snap.size;

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

          // Build enrichable items for this page
          const pageItems: Array<ItemMovie | ItemEpisode> = [];
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
              pageItems.push({ mediaId: d.id, type: "movie", title, year });
            } else if (m.type === "episode") {
              const season =
                isNum(m.season) ? m.season : isNum(m.seasonNumber) ? m.seasonNumber : undefined;
              const episode =
                isNum(m.episode) ? m.episode : isNum(m.episodeNumber) ? m.episodeNumber : undefined;

              let showTitle = (m.showTitle || null) as string | null;

              // Try the referenced show doc if present
              if (!showTitle && m.showRef && typeof m.showRef === "string") {
                try {
                  const showSnap = await db.doc(m.showRef).get();
                  if (showSnap.exists) {
                    const s = showSnap.data() || {};
                    showTitle =
                      s.normalizedTitle ||
                      s.title ||
                      s.filename ||
                      s.name ||
                      null;
                  }
                } catch {
                  // ignore
                }
              }

              // Last resort: infer from filename/title
              if (!showTitle) {
                const raw = (m.filename || m.title || "").trim();
                showTitle = inferShowTitleFromFilename(raw);
              }

              if (showTitle && isNum(season) && isNum(episode)) {
                pageItems.push({
                  mediaId: d.id,
                  type: "episode", // <-- fixed
                  title: showTitle, // <-- fixed
                  season,
                  episode,
                });
              } else if (debug) {
                preview.push({
                  mediaId: d.id,
                  reason: "insufficient_episode_fields",
                  have: {
                    showTitle,
                    season,
                    episode,
                    filename: m.filename,
                    title: m.title,
                  },
                });
              }
            }
          }

          candidates += pageItems.length;

          // Enrich whole page in chunks of <= batchSize (and batchSize <= 50)
          for (let i = 0; i < pageItems.length; i += batchSize) {
            const chunk = pageItems.slice(i, i + batchSize);
            if (!chunk.length) continue;
            sentToEnrich += chunk.length;

            const r = await tmdbEnrichFlow(uid, { items: chunk as any });
            await new Promise(resolve => setTimeout(resolve, 1500));
            const results = (r?.results || []) as Array<{
              mediaId: string;
              status: "enriched" | "not_found" | "error";
            }>;

            for (const row of results) {
              if (row.status === "enriched") enriched++;
              else if (row.status === "not_found") notFound++;
              else errors++;
            }

            // Soft deadline guard: if processing everything, bail out with a cursor to resume
            if (Date.now() - started > SOFT_DEADLINE_MS && processAll) {
              const last = snap.docs[snap.docs.length - 1];
              const lastTs = last?.get("updatedAt");
              const tsMs =
                lastTs && typeof lastTs.toMillis === "function"
                  ? lastTs.toMillis()
                  : 0;
              cursor = `${tsMs}|${last.id}`;
              return res.status(200).json({
                scanned,
                candidates,
                sentToEnrich,
                enriched,
                notFound,
                skipped,
                errors,
                nextCursor: cursor,
                ...(debug ? { preview } : {}),
                info: "Soft deadline reached; resume with nextCursor.",
              });
            }
          }

          // Page cursor
          const last = snap.docs[snap.docs.length - 1];
          const lastTs = last?.get("updatedAt");
          const tsMs =
            lastTs && typeof lastTs.toMillis === "function" ? lastTs.toMillis() : 0;
          cursor = snap.size < limit ? "" : `${tsMs}|${last.id}`;

          if (!processAll) break;
          if (!cursor) break;
        }

        return res.status(200).json({
          scanned,
          candidates,
          sentToEnrich,
          enriched,
          notFound,
          skipped,
          errors,
          nextCursor: cursor || null,
          ...(debug ? { preview } : {}),
        });
      } catch (e: any) {
        functions.logger.error("tmdbBackfillMissing fatal", e);
        return res
          .status(500)
          .json({ error: { status: "INTERNAL", message: e?.message || "Internal error" } });
      }
    });
  });
