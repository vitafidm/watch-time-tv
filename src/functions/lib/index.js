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
require("./preinit-admin"); // <-- MUST be first: ensure admin.initializeApp() runs before any flow
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
// Flows
const claim_token_flow_1 = require("./flows/claim-token-flow");
const agent_claim_flow_1 = require("./flows/agent-claim-flow");
const agent_ingest_flow_1 = require("./flows/agent-ingest-flow");
const playback_report_flow_1 = require("./flows/playback-report-flow");
const tmdb_enrich_flow_1 = require("./flows/tmdb-enrich-flow");
const tmdb_enrich_episodes_1 = require("./flows/tmdb-enrich-episodes");
// HTTP handlers (default exports)
const tmdbFixMatch_1 = __importDefault(require("./tmdbFixMatch"));
const tmdbSearch_1 = __importDefault(require("./tmdbSearch"));
const tmdbManualSet_1 = __importDefault(require("./tmdbManualSet"));
const tmdbMedia_1 = __importDefault(require("./tmdbMedia"));
const materializeUserShows_1 = __importDefault(require("./materializeUserShows"));
const tmdbFixShow_1 = __importDefault(require("./tmdbFixShow"));
const tmdbBackfill_1 = __importDefault(require("./tmdbBackfill"));
const materializeUserShowsFromFolders_1 = __importDefault(require("./materializeUserShowsFromFolders"));
const tmdbEnrichShows_1 = __importDefault(require("./tmdbEnrichShows"));
// (Optional, harmless if called again thanks to apps.length guard)
if (!admin.apps.length)
    admin.initializeApp();
const corsHandler = (0, cors_1.default)({ origin: true });
exports.claimToken = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method !== "POST")
            return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
        try {
            const hdr = req.headers.authorization || "";
            if (!hdr.startsWith("Bearer "))
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const decoded = await admin.auth().verifyIdToken(hdr.substring(7));
            if (!decoded?.uid)
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const out = await (0, claim_token_flow_1.createClaimTokenFlow)(decoded.uid);
            return res.status(200).json(out);
        }
        catch (e) {
            if (e?.name === "RateLimitError")
                return res.status(429).json({ error: { status: "RESOURCE_EXHAUSTED", message: e.message } });
            functions.logger.error("claimToken error", e);
            return res.status(500).json({ error: { status: "INTERNAL" } });
        }
    });
});
exports.agentClaim = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method !== "POST")
            return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
        try {
            const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
                req.socket?.remoteAddress ||
                null;
            const { claimPublicId, claimSecret, agentName, agentVersion } = req.body || {};
            if (!claimPublicId || !claimSecret)
                return res.status(400).json({ error: { status: "INVALID_ARGUMENT" } });
            const out = await (0, agent_claim_flow_1.agentClaimFlow)({ claimPublicId, claimSecret, agentName, agentVersion, requesterIp: ip });
            return res.status(200).json(out);
        }
        catch (e) {
            const code = e?.code;
            if (code === "permission-denied")
                return res.status(403).json({ error: { status: "PERMISSION_DENIED", message: e.message } });
            if (code === "failed-precondition")
                return res.status(410).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
            if (code === "already-exists")
                return res.status(409).json({ error: { status: "ALREADY_EXISTS", message: e.message } });
            if (code === "internal-config")
                return res.status(500).json({ error: { status: "INTERNAL_CONFIG" } });
            functions.logger.error("agentClaim error", e);
            return res.status(500).json({ error: { status: "INTERNAL" } });
        }
    });
});
exports.agentIngest = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method !== "POST")
            return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
        const len = req.headers["content-length"];
        if (len && parseInt(len, 10) > 5 * 1024 * 1024) {
            return res.status(413).json({ error: { status: "PAYLOAD_TOO_LARGE" } });
        }
        const hdr = req.headers.authorization || "";
        if (!hdr.startsWith("Bearer "))
            return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
        const apiKey = hdr.substring(7);
        try {
            const { results } = await (0, agent_ingest_flow_1.agentIngestFlow)({ apiKey, ...(req.body || {}) });
            const ok = (results || []).filter((r) => r.status === "upserted").length;
            if (!results?.length)
                return res.status(200).json({ results: [] });
            if (ok === results.length)
                return res.status(200).json({ results });
            if (ok === 0)
                return res.status(400).json({ results });
            return res.status(207).json({ results });
        }
        catch (e) {
            if (e?.code === "permission-denied")
                return res.status(403).json({ error: { status: "PERMISSION_DENIED", message: e.message } });
            functions.logger.error("agentIngest error", e);
            return res.status(500).json({ error: { status: "INTERNAL" } });
        }
    });
});
exports.playbackReport = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method !== "POST")
            return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
        try {
            const hdr = req.headers.authorization || "";
            if (!hdr.startsWith("Bearer "))
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const idToken = hdr.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid)
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const out = await (0, playback_report_flow_1.playbackReportFlow)(decoded.uid, req.body);
            return res.status(200).json(out);
        }
        catch (e) {
            const code = e?.code;
            if (code === "invalid-argument")
                return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: e.message } });
            if (code === "failed-precondition")
                return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
            functions.logger.error("playbackReport error", e);
            return res.status(500).json({ error: { status: "INTERNAL" } });
        }
    });
});
exports.tmdbEnrich = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST")
                return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
            const hdr = req.headers.authorization || "";
            if (!hdr.startsWith("Bearer "))
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const idToken = hdr.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid)
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            const out = await (0, tmdb_enrich_flow_1.tmdbEnrichFlow)(decoded.uid, req.body);
            return res.status(200).json(out);
        }
        catch (e) {
            const code = e?.code;
            if (code === "invalid-argument")
                return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: e.message } });
            if (code === "failed-precondition")
                return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
            if (code === "resource-exhausted")
                return res.status(429).json({ error: { status: "RESOURCE_EXHAUSTED", message: e.message } });
            functions.logger.error("tmdbEnrich error", e);
            return res.status(500).json({ error: { status: "INTERNAL" } });
        }
    });
});
exports.tmdbEnrichEpisodes = functions.https.onRequest(async (req, res) => {
    return corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED" } });
            }
            const hdr = req.headers.authorization || "";
            if (!hdr.startsWith("Bearer ")) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            }
            const idToken = hdr.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED" } });
            }
            const out = await (0, tmdb_enrich_episodes_1.tmdbEnrichEpisodes)(decoded.uid, req.body);
            return res.status(200).json(out);
        }
        catch (e) {
            const code = e?.code;
            if (code === "invalid-argument") {
                return res.status(400).json({ error: { status: "INVALID_ARGUMENT", message: e.message } });
            }
            if (code === "failed-precondition") {
                return res.status(412).json({ error: { status: "FAILED_PRECONDITION", message: e.message } });
            }
            functions.logger.error("tmdbEnrichEpisodes error", e);
            return res.status(500).json({ error: { status: "INTERNAL", message: e.message } });
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
exports.tmdbBackfillMissing = tmdbBackfill_1.default;
exports.tmdbSearch = tmdbSearch_1.default;
exports.tmdbFixMatch = tmdbFixMatch_1.default;
exports.tmdbManualSet = tmdbManualSet_1.default;
exports.tmdbMedia = tmdbMedia_1.default;
exports.materializeUserShows = materializeUserShows_1.default;
exports.tmdbFixShow = tmdbFixShow_1.default;
exports.materializeUserShowsFromFolders = materializeUserShowsFromFolders_1.default;
exports.tmdbEnrichShows = tmdbEnrichShows_1.default;
