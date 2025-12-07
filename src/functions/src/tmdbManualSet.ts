import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { db } from './initFirebase';

const corsHandler = cors({ origin: true });

export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // --- CORS preflight (OPTIONS) ---
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
      res.status(204).send('');
      return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    try {
      // Always echo CORS on real responses
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');

      // Require Firebase Auth (browser will attach ID token)
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
      }

      const {
        collection,
        docId,
        posterUrl,
        backdropUrl,
        videoLink,
        logoUrl,             // NEW
      } = req.body || {};

      if (!collection || !docId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Missing required fields: collection and docId.'
        );
      }

      const docRef = db.doc(`${collection}/${docId}`);

      const updatePayload: Record<string, any> = {};
      const lockedFields: string[] = [];

      if (typeof posterUrl === 'string' && posterUrl.length) {
        updatePayload.posterUrl = posterUrl;
        updatePayload.posterLocked = true;
        lockedFields.push('posterUrl');
      }
      if (typeof backdropUrl === 'string' && backdropUrl.length) {
        updatePayload.backdropUrl = backdropUrl;
        updatePayload.backdropLocked = true;
        lockedFields.push('backdropUrl');
      }
      if (typeof videoLink === 'string' && videoLink.length) {
        updatePayload.videoLink = videoLink;
        updatePayload.videoLocked = true;
        lockedFields.push('videoLink');
      }
      if (typeof logoUrl === 'string' && logoUrl.length) {
        updatePayload.logoUrl = logoUrl;
        updatePayload.logoLocked = true;
        lockedFields.push('logoUrl');
      }

      if (Object.keys(updatePayload).length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'No fields to update.');
      }

      // Use firebase-admin's FieldValue
      updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await docRef.update(updatePayload);

      res.status(200).json({ ok: true, docId, locked: lockedFields });
    } catch (error: any) {
      functions.logger.error('Error in tmdbManualSet:', error);
      const code = error.code || 'internal';
      const message = error.message || 'An internal error occurred.';
      const httpStatus =
        code === 'unauthenticated' ? 401 :
        code === 'invalid-argument' ? 400 : 500;

      // Ensure CORS headers even on errors
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.status(httpStatus).json({ error: { code, message } });
    }
  });
});
