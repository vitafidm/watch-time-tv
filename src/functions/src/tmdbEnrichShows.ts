// functions/tmdbEnrichShows.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import fetch from "node-fetch";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const corsHandler = cors({ origin: true });

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

function fullImg(path?: string | null, size: "original" | "w500" | "w185" = "original"): string | null {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

// Trailer picker (prefers official YouTube trailer)
function pickYouTubeTrailer(results: any[] | undefined): string | null {
  if (!Array.isArray(results)) return null;
  const best =
    results.find((v: any) => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
    results.find((v: any) => v.site === "YouTube" && v.type === "Trailer") ||
    results.find((v: any) => v.site === "YouTube");
  return best?.key ? `https://www.youtube.com/watch?v=${best.key}` : null;
}

// TMDB search
async function tmdbSearchShow(apiKey: string, title: string) {
  const url = new URL(`${TMDB_BASE}/search/tv`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  url.searchParams.set("include_adult", "false");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  return (j?.results || [])[0] || null;
}

// TMDB details with rich data
async function tmdbShowDetails(apiKey: string, id: number) {
  const url = new URL(`${TMDB_BASE}/tv/${id}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("append_to_response", "aggregate_credits,videos");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  return (await r.json()) as any;
}

const handler = async (req: functions.https.Request, res: functions.Response) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
      }

      // --- Auth ---
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
      }
      const idToken = authHeader.slice("Bearer ".length);
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      if (!uid) throw new functions.https.HttpsError("unauthenticated", "Invalid ID token.");

      const { batchSize = 25, startAfterId } = (req.body || {}) as {
        batchSize?: number;
        startAfterId?: string;
      };
      functions.logger.info("tmdbEnrichShows called", { uid, batchSize, startAfterId });

      const apiKey = process.env.TMDB_API_KEY;
      if (!apiKey) throw new functions.https.HttpsError("failed-precondition", "TMDB_API_KEY not set");

      // --- Query: only shows that still need enrichment ---
      // Rely on materializer to set tmdbShowId = null on new/legacy docs.
      let q = db
        .collection(`users/${uid}/shows`)
        .where("tmdbShowId", "==", null)
        .orderBy(admin.firestore.FieldPath.documentId());

      if (startAfterId) q = q.startAfter(startAfterId);

      const snap = await q.limit(Math.max(1, Math.min(100, Number(batchSize) || 25))).get();
      if (snap.empty) return res.json({ processed: 0, enriched: 0, skipped: 0, notFound: 0 });

      let processed = 0;
      let enriched = 0;
      let skipped = 0;
      let notFound = 0;

      for (const doc of snap.docs) {
        processed++;
        const data = doc.data() || {};

        // Honor negative cache
        if (data.matchStatus === "not_found") {
          skipped++;
          continue;
        }

        // Compose best input title
        const title: string | null =
          (typeof data.title === "string" && data.title.trim()) ||
          (typeof data.titleCandidate === "string" && data.titleCandidate.trim()) ||
          (typeof data.normalizedTitle === "string" && data.normalizedTitle.trim()) ||
          null;

        if (!title) {
          await doc.ref.set(
            { matchStatus: "not_found", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          notFound++;
          continue;
        }

        try {
          const hit = await tmdbSearchShow(apiKey, title);
          if (!hit) {
            await doc.ref.set(
              { matchStatus: "not_found", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true }
            );
            notFound++;
            continue;
          }

          const details = await tmdbShowDetails(apiKey, hit.id);
          if (!details) {
            await doc.ref.set(
              { matchStatus: "not_found", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true }
            );
            notFound++;
            continue;
          }

          // Respect locks: don't overwrite poster/backdrop if locked
          const posterLocked = !!data.posterLocked;
          const backdropLocked = !!data.backdropLocked;

          const update: Record<string, any> = {
            // Write BOTH ids for compatibility
            tmdbId: details.id,
            tmdbShowId: details.id,
            tmdbType: "tv",

            title: details.name || title,
            normalizedTitle: details.name || title,
            overview: details.overview || null,
            genres: (details.genres || []).map((g: any) => g?.name).filter(Boolean),
            firstAirDate: details.first_air_date || null,
            voteAverage: details.vote_average ?? null,
            language: details.original_language ?? null,

            // Images (respect locks)
            ...(posterLocked ? {} : { posterUrl: fullImg(details.poster_path, "w500") }),
            ...(backdropLocked ? {} : { backdropUrl: fullImg(details.backdrop_path, "original") }),

            // Rich fields
            cast: (details.aggregate_credits?.cast || [])
              .slice(0, 10)
              .map((c: any) => ({
                name: c?.name || "",
                character:
                  (Array.isArray(c?.roles)
                    ? c.roles.map((r: any) => r?.character).filter(Boolean).join(", ")
                    : c?.character) || "",
                profileUrl: fullImg(c?.profile_path, "w185"),
              })),
            videoLink: pickYouTubeTrailer(details.videos?.results) || null,

            matchStatus: "matched",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          await doc.ref.set(update, { merge: true });
          enriched++;
        } catch (err: any) {
          functions.logger.error("tmdbEnrichShows inner error", { showId: doc.id, error: err });
          await doc.ref.set(
            { matchStatus: "error", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          notFound++;
        }
      }

      const lastDoc = snap.docs[snap.docs.length - 1];
      const nextStartAfterId = lastDoc?.id || null;

      return res.json({ processed, enriched, skipped, notFound, nextStartAfterId });
    } catch (err: any) {
      functions.logger.error("tmdbEnrichShows fatal", { error: err });
      const code = err?.code || "internal";
      const message = err?.message || "An internal error occurred.";
      const status = code === "unauthenticated" ? 403 : code === "invalid-argument" ? 400 : 500;
      return res.status(status).json({ error: { code, message } });
    }
  });
};

export default functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(handler);
