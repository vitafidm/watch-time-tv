
import * as functions from 'firebase-functions';
import cors from 'cors';
import { db } from './initFirebase';

const corsHandler = cors({ origin: true });

export default functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method Not Allowed' });
            return;
        }

        try {
            // In a real app, you would verify the Firebase Auth ID token here
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
            }

            const { collection, docId, posterUrl, backdropUrl, videoLink } = req.body;

            if (!collection || !docId) {
                throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: collection and docId.');
            }

            const docRef = db.doc(`${collection}/${docId}`);
            
            const updatePayload: Record<string, any> = {};
            const lockedFields: string[] = [];

            if (typeof posterUrl === 'string') {
                updatePayload.posterUrl = posterUrl;
                updatePayload.posterLocked = true;
                lockedFields.push('posterUrl');
            }
            if (typeof backdropUrl === 'string') {
                updatePayload.backdropUrl = backdropUrl;
                updatePayload.backdropLocked = true;
                lockedFields.push('backdropUrl');
            }
            if (typeof videoLink === 'string') {
                updatePayload.videoLink = videoLink;
                updatePayload.videoLocked = true;
                lockedFields.push('videoLink');
            }

            if (Object.keys(updatePayload).length === 0) {
                 throw new functions.https.HttpsError('invalid-argument', 'No fields to update.');
            }
            
            updatePayload.updatedAt = functions.firestore.FieldValue.serverTimestamp();

            await docRef.update(updatePayload);

            res.status(200).json({ ok: true, docId, locked: lockedFields });

        } catch (error: any) {
            functions.logger.error("Error in tmdbManualSet:", error);
            const code = error.code || 'internal';
            const message = error.message || 'An internal error occurred.';
            const httpStatus = code === 'unauthenticated' ? 401 : code === 'invalid-argument' ? 400 : 500;
            res.status(httpStatus).json({ error: { code, message } });
        }
    });
});
