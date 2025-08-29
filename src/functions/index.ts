
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as cors from 'cors';
import { createClaimTokenFlow } from './flows/claim-token-flow';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const corsHandler = cors({ origin: true });

/**
 * An HTTPS endpoint to generate a one-time claim token for a local agent.
 * The user must be authenticated.
 */
export const claimToken = functions.https.onRequest(async (req, res) => {
  // Use a standard CORS middleware handler
  corsHandler(req, res, async () => {
    // We only support POST requests for this endpoint
    if (req.method !== 'POST') {
      res.status(405).json({
        error: { status: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' },
      });
      return;
    }

    try {
      // 1. Authentication: Verify the Firebase ID token from the Authorization header.
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: {
            status: 'UNAUTHENTICATED',
            message: 'Missing or invalid Authorization header. Use `Bearer <ID_TOKEN>`.',
          },
        });
        return;
      }

      const idToken = authHeader.substring('Bearer '.length);
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      if (!decodedToken?.uid) {
        res.status(401).json({
          error: { status: 'UNAUTHENTICATED', message: 'Invalid ID token.' },
        });
        return;
      }

      // 2. Execute the business logic flow
      const result = await createClaimTokenFlow(decodedToken.uid);
      res.status(200).json(result);

    } catch (err: any) {
      // 3. Error Handling: Respond with specific codes for known errors
      if (err.name === 'RateLimitError') {
        res.status(429).json({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: err.message,
          },
        });
      } else {
        functions.logger.error('Unhandled error in claimToken:', err);
        res.status(500).json({
          error: { status: 'INTERNAL', message: 'An internal error occurred.' },
        });
      }
    }
  });
});
