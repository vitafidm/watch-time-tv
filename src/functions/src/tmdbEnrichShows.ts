
// functions/tmdbEnrichShows.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import fetch from "node-fetch";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const corsHandler = cors({ origin: true });

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";

// pick best TMDB image path -> full URL
function pickBestImage(path?: string | null): string | null {
  return path ? `${IMG_BASE}${path}` : null;
}

// Search TMDB for TV show by title
async function tmdbSearchShow(apiKey: string, title: string) {
  const url = new URL(`${TMDB_BASE}/search/tv`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  url.searchParams.set("include_adult", "false");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const j = await r.json() as any;
  return (j?.results || [])[0] || null;
}

// Fetch TMDB show details
async function tmdbShowDetails(apiKey: string, id: number) {
  const url = new URL(`${TMDB_BASE}/tv/${id}`);
  url.searchParams.set("api_key", apiKey);
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  return r.json() as any;
}

/**
 * POST body: { batchSize?: number, startAfterId?: string }
 * Returns: { processed:number, enriched:number, skipped:number, notFound:number, nextStartAfterId?:string }
 */
const handler = async (req: functions.https.Request, res: functions.Response) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
      }

      // 1. Authentication
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
      }
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;
      
      if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Invalid ID token.");
      }
      
      // 2. Safe Input Handling
      const { batchSize = 20, startAfterId } = (req.body || {});

      // 3. Robust Logging
      functions.logger.info("tmdbEnrichShows called", { uid, body: req.body });

      if (!process.env.TMDB_API_KEY) {
        throw new functions.https.HttpsError("failed-precondition", "TMDB_API_KEY not set");
      }
      const apiKey = process.env.TMDB_API_KEY;

      let q = db.collection(`users/${uid}/shows`).orderBy(admin.firestore.FieldPath.documentId());
      if (startAfterId) q = q.startAfter(startAfterId);
      const snap = await q.limit(batchSize).get();

      if (snap.empty) {
        return res.json({ processed: 0, enriched: 0, skipped: 0, notFound: 0 });
      }

      let processed = 0;
      let enriched = 0;
      let skipped = 0;
      let notFound = 0;

      for (const doc of snap.docs) {
        processed++;
        const data = doc.data() || {};
        const { title, tmdbShowId, posterUrl } = data;

        // Skip if already enriched
        if (tmdbShowId && posterUrl) {
          skipped++;
          continue;
        }

        if (!title) {
          notFound++;
          continue;
        }

        try {
          const hit = await tmdbSearchShow(apiKey, title);
          if (!hit) {
            notFound++;
            continue;
          }

          const details = await tmdbShowDetails(apiKey, hit.id);
          if (!details) {
            notFound++;
            continue;
          }

          const update = {
            tmdbShowId: details.id,
            title: details.name || title,
            overview: details.overview || null,
            genres: (details.genres || []).map((g: any) => g.name).filter(Boolean),
            posterUrl: pickBestImage(details.poster_path),
            backdropUrl: pickBestImage(details.backdrop_path),
            firstAirDate: details.first_air_date || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          await doc.ref.set(update, { merge: true });
          enriched++;
        } catch (err: any) {
          // Log the full error for better debugging
          functions.logger.error("tmdbEnrichShows inner error", {
            showId: doc.id,
            error: err,
          });
          notFound++;
        }
      }

      const lastDoc = snap.docs[snap.docs.length - 1];
      const nextStartAfterId = lastDoc?.id;

      return res.json({ processed, enriched, skipped, notFound, nextStartAfterId });
    } catch (err: any) {
      // Log the full error object for the entire handler
      functions.logger.error("tmdbEnrichShows fatal", { error: err });
      const code = err.code || 'internal';
      const message = err.message || 'An internal error occurred.';
      const httpStatus = code === 'unauthenticated' || code === 'permission-denied' ? 403 : code === 'invalid-argument' ? 400 : 500;
      return res.status(httpStatus).json({ error: { code, message } });
    }
  });
};

export default functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(handler);
