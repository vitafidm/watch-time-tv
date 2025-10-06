import * as functions from "firebase-functions";
import cors from "cors";
import * as admin from "firebase-admin";
import { db } from "./initFirebase";
import { getShowFromCacheOrTMDB } from "./showCache";

const corsHandler = cors({ origin: true });

async function countEpisodesForShowRef(uid: string, showId: number): Promise<number> {
  const mediaCol = db.collection(`users/${uid}/media`);
  const refA = `shows/${showId}`;
  const refB = `/users/${uid}/shows/${showId}`;

  const [snapA, snapB] = await Promise.all([
    mediaCol.where("type", "==", "episode").where("showRef", "==", refA).count().get(),
    mediaCol.where("type", "==", "episode").where("showRef", "==", refB).count().get(),
  ]);

  return snapA.data().count + snapB.data().count;
}

export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res
        .status(405)
        .json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" } });
      return;
    }

    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "Missing or invalid Authorization header."
        );
      }
      const idToken = authHeader.substring("Bearer ".length);
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      const { uid, oldShowId, newShowId, keepOverrides = true } = req.body;

      if (decodedToken.uid !== uid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Caller does not have permission to access the requested resource."
        );
      }

      if (!uid || !oldShowId || !newShowId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing required fields: uid, oldShowId, newShowId."
        );
      }

      const oldShowRef = db.doc(`users/${uid}/shows/${oldShowId}`);
      const newShowRef = db.doc(`users/${uid}/shows/${newShowId}`);
      const mediaCol = db.collection(`users/${uid}/media`);

      // --- 1. Upsert new show doc, preserving overrides ---
      const [oldShowSnap, newShowDataFromCache] = await Promise.all([
        oldShowRef.get(),
        getShowFromCacheOrTMDB(newShowId),
      ]);

      if (!newShowDataFromCache) {
        throw new functions.https.HttpsError(
          "not-found",
          `Could not find show with newShowId: ${newShowId}`
        );
      }

      // Safe type assertion for TMDB-style payloads
      const tmdbLike = newShowDataFromCache as {
        id?: number;
        title?: string;
        name?: string;
        overview?: string;
        genres?: { name: string }[];
        first_air_date?: string;
        vote_average?: number;
        poster_path?: string;
        backdrop_path?: string;
      };

      const newShowPayload: any = {
        tmdbShowId: tmdbLike.id ?? newShowId,
        title: tmdbLike.title || tmdbLike.name || null,
        overview: tmdbLike.overview || null,
        genres:
          (tmdbLike.genres || []).map((g) => g.name).filter(Boolean) || [],
        firstAirDate: tmdbLike.first_air_date || null,
        voteAverage: tmdbLike.vote_average ?? null,
        posterUrl: tmdbLike.poster_path
          ? `https://image.tmdb.org/t/p/original${tmdbLike.poster_path}`
          : null,
        backdropUrl: tmdbLike.backdrop_path
          ? `https://image.tmdb.org/t/p/original${tmdbLike.backdrop_path}`
          : null,
        tmdbType: "tv",
        matchStatus: "matched",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (keepOverrides && oldShowSnap.exists) {
        const oldShowData = oldShowSnap.data()!;
        if (oldShowData.displayTitle)
          newShowPayload.displayTitle = oldShowData.displayTitle;
        if (oldShowData.posterLocked && oldShowData.posterUrl)
          newShowPayload.posterUrl = oldShowData.posterUrl;
        if (oldShowData.backdropLocked && oldShowData.backdropUrl)
          newShowPayload.backdropUrl = oldShowData.backdropUrl;
        if (oldShowData.videoLocked && oldShowData.videoLink)
          newShowPayload.videoLink = oldShowData.videoLink;
      }

      await newShowRef.set(newShowPayload, { merge: true });

      // --- 2. Find and retarget episodes ---
      const oldRefStr1 = `shows/${oldShowId}`;
      const oldRefStr2 = `/users/${uid}/shows/${oldShowId}`;
      const q1 = mediaCol
        .where("type", "==", "episode")
        .where("showRef", "==", oldRefStr1);
      const q2 = mediaCol
        .where("type", "==", "episode")
        .where("showRef", "==", oldRefStr2);

      const [snap1, snap2] = await Promise.all([q1.get(), q2.get()]);
      const allDocs = [...snap1.docs, ...snap2.docs];
      const uniqueDocs = Array.from(
        new Map(allDocs.map((doc) => [doc.id, doc])).values()
      );
      let movedEpisodes = 0;

      const BATCH_SIZE = 450;
      for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = uniqueDocs.slice(i, i + BATCH_SIZE);
        for (const doc of chunk) {
          batch.update(doc.ref, {
            showRef: `shows/${newShowId}`,
            tmdbShowId: newShowId,
          });
        }
        await batch.commit();
        movedEpisodes += chunk.length;
      }

      // --- 3. Recompute episode counts and clean up old show ---
      const [newEpisodeCount, oldEpisodeCount] = await Promise.all([
        countEpisodesForShowRef(uid, newShowId),
        countEpisodesForShowRef(uid, oldShowId),
      ]);

      await newShowRef.update({ episodeCount: newEpisodeCount });

      if (oldShowSnap.exists) {
        if (oldEpisodeCount === 0) {
          await oldShowRef.delete();
        } else {
          await oldShowRef.update({ episodeCount: oldEpisodeCount });
        }
      }

      res
        .status(200)
        .json({ movedEpisodes, newEpisodeCount, oldEpisodeCount });
    } catch (error: any) {
      functions.logger.error("Error in tmdbFixShow:", error);
      const code = error.code || "internal";
      const message = error.message || "An internal error occurred.";
      res
        .status(
          code === "unauthenticated" || code === "permission-denied"
            ? 403
            : code === "not-found"
            ? 404
            : code === "invalid-argument"
            ? 400
            : 500
        )
        .json({ error: { code, message } });
    }
  });
});
