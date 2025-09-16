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
const cors_1 = __importDefault(require("cors"));
const admin = __importStar(require("firebase-admin"));
const initFirebase_1 = require("./initFirebase");
const showCache_1 = require("./showCache");
const corsHandler = (0, cors_1.default)({ origin: true });
async function countEpisodesForShowRef(uid, showId) {
    const mediaCol = initFirebase_1.db.collection(`users/${uid}/media`);
    const refA = `shows/${showId}`;
    const refB = `/users/${uid}/shows/${showId}`;
    const [snapA, snapB] = await Promise.all([
        mediaCol.where("type", "==", "episode").where("showRef", "==", refA).count().get(),
        mediaCol.where("type", "==", "episode").where("showRef", "==", refB).count().get()
    ]);
    // This double query is needed because we can't do an OR query on different values.
    // In practice, we should normalize to one format, but this handles legacy data.
    // This is a rough count as it could double-count if somehow both refs existed.
    // For this specific use case (recomputing count after a move), it's acceptable.
    return snapA.data().count + snapB.data().count;
}
exports.default = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: { status: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
            return;
        }
        try {
            const authHeader = req.headers.authorization || '';
            if (!authHeader.startsWith('Bearer ')) {
                throw new functions.https.HttpsError('unauthenticated', 'Missing or invalid Authorization header.');
            }
            const idToken = authHeader.substring('Bearer '.length);
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const { uid, oldShowId, newShowId, keepOverrides = true } = req.body;
            if (decodedToken.uid !== uid) {
                throw new functions.https.HttpsError('permission-denied', 'Caller does not have permission to access the requested resource.');
            }
            if (!uid || !oldShowId || !newShowId) {
                throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: uid, oldShowId, newShowId.');
            }
            const oldShowRef = initFirebase_1.db.doc(`users/${uid}/shows/${oldShowId}`);
            const newShowRef = initFirebase_1.db.doc(`users/${uid}/shows/${newShowId}`);
            const mediaCol = initFirebase_1.db.collection(`users/${uid}/media`);
            // 1. Upsert new show doc, preserving overrides
            const [oldShowSnap, newShowDataFromCache] = await Promise.all([
                oldShowRef.get(),
                (0, showCache_1.getShowFromCacheOrTMDB)(newShowId)
            ]);
            if (!newShowDataFromCache) {
                throw new functions.https.HttpsError('not-found', `Could not find show with newShowId: ${newShowId}`);
            }
            const newShowPayload = {
                ...newShowDataFromCache, // from global cache
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (keepOverrides && oldShowSnap.exists) {
                const oldShowData = oldShowSnap.data();
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
            // 2. Find and retarget episodes
            const oldRefStr1 = `shows/${oldShowId}`;
            const oldRefStr2 = `/users/${uid}/shows/${oldShowId}`;
            const q1 = mediaCol.where('type', '==', 'episode').where('showRef', '==', oldRefStr1);
            const q2 = mediaCol.where('type', '==', 'episode').where('showRef', '==', oldRefStr2);
            const [snap1, snap2] = await Promise.all([q1.get(), q2.get()]);
            const allDocs = [...snap1.docs, ...snap2.docs];
            const uniqueDocs = Array.from(new Map(allDocs.map(doc => [doc.id, doc])).values());
            let movedEpisodes = 0;
            const BATCH_SIZE = 450;
            for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
                const batch = initFirebase_1.db.batch();
                const chunk = uniqueDocs.slice(i, i + BATCH_SIZE);
                for (const doc of chunk) {
                    batch.update(doc.ref, {
                        showRef: `shows/${newShowId}`,
                        tmdbShowId: newShowId
                    });
                }
                await batch.commit();
                movedEpisodes += chunk.length;
            }
            // 3. Recompute episode counts and clean up old show
            const [newEpisodeCount, oldEpisodeCount] = await Promise.all([
                countEpisodesForShowRef(uid, newShowId),
                countEpisodesForShowRef(uid, oldShowId)
            ]);
            await newShowRef.update({ episodeCount: newEpisodeCount });
            if (oldShowSnap.exists) {
                if (oldEpisodeCount === 0) {
                    await oldShowRef.delete();
                }
                else {
                    await oldShowRef.update({ episodeCount: oldEpisodeCount });
                }
            }
            res.status(200).json({ movedEpisodes, newEpisodeCount, oldEpisodeCount });
        }
        catch (error) {
            functions.logger.error("Error in tmdbFixShow:", error);
            const code = error.code || 'internal';
            const message = error.message || 'An internal error occurred.';
            res.status(code === 'unauthenticated' || code === 'permission-denied' ? 403 : code === 'not-found' ? 404 : code === 'invalid-argument' ? 400 : 500).json({ error: { code, message } });
        }
    });
});
//# sourceMappingURL=tmdbFixShow.js.map