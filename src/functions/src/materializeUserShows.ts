import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { db } from './initFirebase';
import { getShowFromCacheOrTMDB } from './showCache';
import type { MediaDoc, ShowDoc } from './types';

const corsHandler = cors({ origin: true });

export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
      }
      
      const { uid, batchSize = 50, startAfterShowId } = req.body;
      if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required field: uid.');
      }

      let query = db.collection(`users/${uid}/media`)
        .where('type', '==', 'episode')
        .where('tmdbShowId', '!=', null)
        .orderBy('tmdbShowId', 'asc')
        .orderBy('addedAt', 'desc')
        .limit(batchSize * 5); // Fetch more episodes to ensure we get full shows

      if (startAfterShowId) {
        query = query.startAfter(startAfterShowId);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        res.status(200).json({ processed: 0, created: 0, updated: 0, message: "No more episodes to process." });
        return;
      }
      
      const episodesByShow: Map<number, MediaDoc[]> = new Map();
      snapshot.docs.forEach(doc => {
        const episode = doc.data() as MediaDoc;
        if (episode.tmdbShowId) {
          if (!episodesByShow.has(episode.tmdbShowId)) {
            episodesByShow.set(episode.tmdbShowId, []);
          }
          episodesByShow.get(episode.tmdbShowId)!.push(episode);
        }
      });
      
      let created = 0;
      let updated = 0;
      let lastProcessedShowId: number | undefined;

      const showIdsToProcess = Array.from(episodesByShow.keys()).slice(0, batchSize);

      for (const showId of showIdsToProcess) {
        lastProcessedShowId = showId;
        const episodes = episodesByShow.get(showId)!;

        const showCache = await getShowFromCacheOrTMDB(showId);
        if (!showCache) continue;

        const episodeCount = episodes.length;
        const lastAddedAt = episodes.reduce((latest, ep) => {
            const currentTs = ep.addedAt || ep.updatedAt;
            if (!latest || (currentTs && currentTs > latest)) return currentTs;
            return latest;
        }, null as admin.firestore.Timestamp | null);

        const showRef = db.collection(`users/${uid}/shows`).doc(String(showId));
        const showSnap = await showRef.get();

        const dataToUpsert: Partial<ShowDoc> = {
            tmdbShowId: showId,
            title: showCache.title,
            overview: showCache.overview,
            genres: showCache.genres,
            posterUrl: showCache.posterUrl,
            backdropUrl: showCache.backdropUrl,
            episodeCount,
            lastAddedAt: lastAddedAt || admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        
        // Do not touch locked fields or displayTitle if they exist
        const existingData = showSnap.exists ? showSnap.data() as ShowDoc : {};
        if (existingData.posterLocked === true) delete dataToUpsert.posterUrl;
        if (existingData.backdropLocked === true) delete dataToUpsert.backdropUrl;
        if (existingData.displayTitle) delete dataToUpsert.title;

        await showRef.set(dataToUpsert, { merge: true });

        if (showSnap.exists) {
          updated++;
        } else {
          created++;
        }
      }

      res.status(200).json({
        processed: showIdsToProcess.length,
        created,
        updated,
        nextStartAfterShowId: lastProcessedShowId,
      });

    } catch (error: any) {
      functions.logger.error("Error in materializeUserShows:", error);
      const code = error.code || 'internal';
      const message = error.message || 'An internal error occurred.';
      res.status(code === 'unauthenticated' ? 401 : code === 'invalid-argument' ? 400 : 500)
         .json({ error: { code, message } });
    }
  });
});
