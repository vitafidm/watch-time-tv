
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as cors from 'cors';
import { createClaimTokenFlow } from './flows/claim-token-flow';
import { agentClaimFlow } from './flows/agent-claim-flow';
import { agentIngestFlow } from './flows/agent-ingest-flow';
import { playbackReportFlow } from './flows/playback-report-flow';
import { tmdbEnrichFlow, tmdbBackfillSweep } from "./flows/tmdb-enrich-flow";

// Initialize Firebase Admin SDK.
if (!admin.apps.length) {
  admin.initializeApp();
}

const corsHandler = cors({ origin: true });

/**
 * An HTTPS endpoint to generate a one-time claim token for a local agent.
 * The user must be authenticated.
 */
export const claimToken = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({
        error: { status: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' },
      });
      return;
    }

    try {
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

      const result = await createClaimTokenFlow(decodedToken.uid);
      res.status(200).json(result);

    } catch (err: any) {
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

/**
 * A public HTTPS endpoint for a local agent to claim its token and receive a
 * permanent API key.
 */
export const agentClaim = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: { status: 'METHOD_NOT_ALLOWED', message: 'Use POST' }});
      return;
    }

    try {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;

      const { claimPublicId, claimSecret, agentName, agentVersion } = req.body || {};
      if (!claimPublicId || !claimSecret) {
        res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'claimPublicId and claimSecret are required' }});
        return;
      }

      const result = await agentClaimFlow({
        claimPublicId,
        claimSecret,
        agentName,
        agentVersion,
        requesterIp: ip,
      });

      res.status(200).json(result);

    } catch (err: any) {
      const code = err?.code;
      if (code === 'permission-denied') {
        res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: err.message }});
      } else if (code === 'failed-precondition') {
        res.status(410).json({ error: { status: 'FAILED_PRECONDITION', message: err.message }});
      } else if (code === 'already-exists') {
        res.status(409).json({ error: { status: 'ALREADY_EXISTS', message: err.message }});
      } else if (code === 'internal-config') {
        res.status(500).json({ error: { status: 'INTERNAL_CONFIG', message: 'A server configuration error occurred. Please check function logs.' } });
      }
      else {
        functions.logger.error('agentClaim error', err);
        res.status(500).json({ error: { status: 'INTERNAL', message: 'Internal error' }});
      }
    }
  });
});

/**
 * A public HTTPS endpoint for an authenticated agent to ingest media metadata.
 */
export const agentIngest = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: { status: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
      return;
    }

    // Enforce a raw body size limit to prevent abuse.
    // Note: Cloud Functions (gen 1) has a default limit of 10MB. This adds a stricter, app-level limit.
    const bodyLength = req.headers['content-length'];
    if (bodyLength && parseInt(bodyLength, 10) > 5 * 1024 * 1024) { // 5 MB
        res.status(413).json({ error: { status: 'PAYLOAD_TOO_LARGE', message: 'Payload size cannot exceed 5MB.' } });
        return;
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Missing Authorization: Bearer <agentApiKey>' } });
      return;
    }
    const apiKey = authHeader.substring('Bearer '.length);

    try {
      const flowPayload = { apiKey, ...req.body };
      const { results } = await agentIngestFlow(flowPayload);
      
      if (!results || results.length === 0) {
        if (req.body.items && req.body.items.length > 0) {
           // Flow returned no results, implies a major validation error before item processing
           res.status(400).json({ results: [{ status: 'error', message: 'Invalid request structure or items array.' }] });
        } else {
           res.status(200).json({ results: [] }); // No items sent, no work done.
        }
        return;
      }
      
      const successCount = results.filter(r => r.status === 'upserted').length;
      const totalCount = results.length;
      
      if (successCount === totalCount) {
        res.status(200).json({ results }); // All succeeded
      } else if (successCount === 0) {
        res.status(400).json({ results }); // All failed
      } else {
        res.status(207).json({ results }); // Partial success
      }
    } catch (err: any) {
      const code = err?.code;
      if (code === 'permission-denied') {
        res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: err.message } });
      } else {
        functions.logger.error('agentIngest unhandled error', err);
        res.status(500).json({ error: { status: 'INTERNAL', message: 'An internal server error occurred.' } });
      }
    }
  });
});

/**
 * An HTTPS endpoint for a logged-in user to report playback progress.
 */
export const playbackReport = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: { status: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
      return;
    }

    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: {
            status: 'UNAUTHENTICATED',
            message: 'Missing or invalid Authorization header. Use `Bearer <ID_TOKEN>`.'
          }
        });
        return;
      }
      const idToken = authHeader.substring('Bearer '.length);
      const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
      
      if (!decoded?.uid) {
        res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Invalid ID token' }});
        return;
      }
      
      const result = await playbackReportFlow(decoded.uid, req.body);
      res.status(200).json(result);

    } catch (err: any)
       {
      const code = err?.code;
      if (code === "invalid-argument") {
        return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: err.message } });
      }
      if (code === "failed-precondition") {
        return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: err.message } });
      }
      functions.logger.error("playbackReport error", err);
      return res.status(500).json({ error: { status: "INTERNAL", message: "Internal error" } });
    }
  });
});


// Protected HTTPS endpoint: POST /api/enrich/tmdb
export const tmdbEnrich = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" }});
      }

      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Missing Authorization: Bearer <ID_TOKEN>" }});
      }
      const idToken = header.substring("Bearer ".length);
      const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
      if (!decoded?.uid) {
        return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Invalid ID token" }});
      }

      const out = await tmdbEnrichFlow(decoded.uid, req.body);
      return res.status(200).json(out);

    } catch (err: any) {
      const code = err?.code;
      if (err?.code === "invalid-argument") {
        return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: err.message }});
      }
      if (err?.code === "failed-precondition") {
        return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: err.message }});
      }
      if (err?.code === "resource-exhausted") {
        return res.status(429).json({ error: { status: "RESOURCE_EXHAUSTED", message: err.message }});
      }
      functions.logger.error("tmdbEnrich error", err);
      return res.status(500).json({ error: { status: "INTERNAL", message: "Internal error" }});
    }
  });
});

// Scheduled backfill every hour
export const tmdbBackfill = functions.pubsub
  .schedule("every 60 minutes")
  .onRun(async () => {
    try {
      const res = await tmdbBackfillSweep();
      functions.logger.info(`TMDB Backfill sweep completed. Processed owners: ${res.ownersProcessed}`);
      return res;
    } catch (e) {
      functions.logger.error("tmdbBackfill error", e);
      return null;
    }
  });
