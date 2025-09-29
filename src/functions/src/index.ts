
import "./preinit-admin"; // <-- MUST be first: ensure admin.initializeApp() runs before any flow

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";

// Flows
import { createClaimTokenFlow } from "./flows/claim-token-flow";
import { agentClaimFlow } from "./flows/agent-claim-flow";
import { agentIngestFlow } from "./flows/agent-ingest-flow";
import { playbackReportFlow } from "./flows/playback-report-flow";
import { tmdbEnrichFlow, tmdbBackfillSweep } from "./flows/tmdb-enrich-flow";

// HTTP handlers (default exports)
import tmdbFixMatch from "./tmdbFixMatch";
import tmdbSearch from "./tmdbSearch";
import tmdbManualSet from "./tmdbManualSet";
import tmdbMedia from "./tmdbMedia";
import materializeUserShows from "./materializeUserShows";
import tmdbFixShow from "./tmdbFixShow";
import tmdbBackfillMissing from "./tmdbBackfill";


// (Optional, harmless if called again thanks to apps.length guard)
if (!admin.apps.length) admin.initializeApp();

const corsHandler = cors({ origin: true });

exports.claimToken = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
    try {
      const hdr = req.headers.authorization || "";
      if (!hdr.startsWith("Bearer ")) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const decoded = await admin.auth().verifyIdToken(hdr.substring(7));
      if (!decoded?.uid) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const out = await createClaimTokenFlow(decoded.uid);
      return res.status(200).json(out);
    } catch (e: any) {
      if (e?.name === "RateLimitError") return res.status(429).json({ error: { status: "RESOURCE_EXHAUSTED", message: e.message } });
      functions.logger.error("claimToken error", e);
      return res.status(500).json({ error: { status: "INTERNAL" } });
    }
  });
});

exports.agentClaim = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
    try {
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;

      const { claimPublicId, claimSecret, agentName, agentVersion } = req.body || {};
      if (!claimPublicId || !claimSecret) return res.status(400).json({ error: { status: "INVALID_ARGUMENT" } });

      const out = await agentClaimFlow({ claimPublicId, claimSecret, agentName, agentVersion, requesterIp: ip });
      return res.status(200).json(out);
    } catch (e: any) {
      const code = e?.code;
      if (code === "permission-denied") return res.status(403).json({ error: { status: "PERMISSION_DENIED", message: e.message } });
      if (code === "failed-precondition") return res.status(410).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
      if (code === "already-exists") return res.status(409).json({ error: { status: "ALREADY_EXISTS", message: e.message } });
      if (code === "internal-config") return res.status(500).json({ error: { status: "INTERNAL_CONFIG" } });
      functions.logger.error("agentClaim error", e);
      return res.status(500).json({ error: { status: "INTERNAL" } });
    }
  });
});

exports.agentIngest = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });

    const len = req.headers["content-length"];
    if (len && parseInt(len, 10) > 5 * 1024 * 1024) {
      return res.status(413).json({ error: { status: "PAYLOAD_TOO_LARGE" } });
    }

    const hdr = req.headers.authorization || "";
    if (!hdr.startsWith("Bearer ")) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
    const apiKey = hdr.substring(7);

    try {
      const { results } = await agentIngestFlow({ apiKey, ...(req.body || {}) });
      const ok = (results || []).filter((r) => r.status === "upserted").length;
      if (!results?.length) return res.status(200).json({ results: [] });
      if (ok === results.length) return res.status(200).json({ results });
      if (ok === 0) return res.status(400).json({ results });
      return res.status(207).json({ results });
    } catch (e: any) {
      if (e?.code === "permission-denied") return res.status(403).json({ error: { status: "PERMISSION_DENIED", message: e.message } });
      functions.logger.error("agentIngest error", e);
      return res.status(500).json({ error: { status: "INTERNAL" } });
    }
  });
});

exports.playbackReport = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
    try {
      const hdr = req.headers.authorization || "";
      if (!hdr.startsWith("Bearer ")) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const idToken = hdr.substring(7);
      const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
      if (!decoded?.uid) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const out = await playbackReportFlow(decoded.uid, req.body);
      return res.status(200).json(out);
    } catch (e: any) {
      const code = e?.code;
      if (code === "invalid-argument") return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: e.message } });
      if (code === "failed-precondition") return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
      functions.logger.error("playbackReport error", e);
      return res.status(500).json({ error: { status: "INTERNAL" } });
    }
  });
});

exports.tmdbEnrich = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
      const hdr = req.headers.authorization || "";
      if (!hdr.startsWith("Bearer ")) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const idToken = hdr.substring(7);
      const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
      if (!decoded?.uid) return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
      const out = await tmdbEnrichFlow(decoded.uid, req.body);
      return res.status(200).json(out);
    } catch (e: any) {
      const code = e?.code;
      if (code === "invalid-argument") return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: e.message } });
      if (code === "failed-precondition") return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
      if (code === "resource-exhausted") return res.status(429).json({ error: { status: "RESOURCE_EXHAUSTED", message: e.message } });
      functions.logger.error("tmdbEnrich error", e);
      return res.status(500).json({ error: { status: "INTERNAL" } });
    }
  });
});

/*
exports.tmdbBackfill = functions.pubsub
  .schedule("every 60 minutes")
  .onRun(async () => {
    try {
      return await tmdbBackfillSweep();
    } catch (e) {
      functions.logger.error("tmdbBackfill error", e);
      return null;
    }
  });
*/

// direct
exports.tmdbBackfillMissing = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(tmdbBackfillMissing);
exports.tmdbSearch = tmdbSearch;
exports.tmdbFixMatch = tmdbFixMatch;
exports.tmdbManualSet = tmdbManualSet;
exports.tmdbMedia = tmdbMedia;
exports.materializeUserShows = materializeUserShows;
exports.tmdbFixShow = tmdbFixShow;
