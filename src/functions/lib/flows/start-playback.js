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
exports.startPlayback = void 0;
// functions/src/flows/start-playback.ts
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Initialize Admin SDK once
try {
    if (!admin.apps.length)
        admin.initializeApp();
}
catch {
    /* no-op */
}
// Helper: read "Authorization: Bearer <idToken>"
function getBearerToken(req) {
    // Prefer Express's req.get(); fall back to headers
    const header = req.get?.("Authorization") ||
        req.get?.("authorization") ||
        req.headers?.authorization ||
        req.headers?.Authorization;
    if (!header || typeof header !== "string")
        return null;
    if (!header.startsWith("Bearer "))
        return null;
    return header.slice("Bearer ".length).trim();
}
/**
 * startPlayback (HTTPS)
 * POST only. Requires Firebase ID token in Authorization header.
 * Body: { mediaId: string }
 * Returns: { url: string, expiresAt: number }
 */
exports.startPlayback = (0, https_1.onRequest)({
    region: "us-central1",
    cors: true,
    // Tell Functions to inject these secrets into process.env
    secrets: ["STREAM_JWT_PRIVATE_KEY", "STREAM_BASE_URL"],
}, async (req, res) => {
    try {
        if (req.method !== "POST") {
            res.status(405).set("Allow", "POST").json({ error: "Method Not Allowed" });
            return;
        }
        // 1) Verify caller is signed in
        const idToken = getBearerToken(req);
        if (!idToken) {
            throw new https_1.HttpsError("unauthenticated", "Missing Authorization: Bearer <idToken> header.");
        }
        let decoded;
        try {
            decoded = await admin.auth().verifyIdToken(idToken);
        }
        catch {
            throw new https_1.HttpsError("unauthenticated", "Invalid or expired Firebase ID token.");
        }
        const uid = decoded.uid;
        // 2) Parse JSON body
        const body = (req.body ?? {});
        const mediaId = (body.mediaId || "").trim();
        if (!mediaId) {
            throw new https_1.HttpsError("invalid-argument", "Body must include a non-empty 'mediaId' string.");
        }
        // 3) Ensure media exists for this user
        const mediaRef = admin.firestore().doc(`users/${uid}/media/${mediaId}`);
        const mediaSnap = await mediaRef.get();
        if (!mediaSnap.exists) {
            throw new https_1.HttpsError("not-found", "Media not found or not owned by this user.");
        }
        // 4) Build a short-lived JWT "ticket"
        const privateKey = process.env.STREAM_JWT_PRIVATE_KEY;
        const baseUrlRaw = process.env.STREAM_BASE_URL;
        if (!privateKey)
            throw new https_1.HttpsError("failed-precondition", "STREAM_JWT_PRIVATE_KEY not available.");
        if (!baseUrlRaw)
            throw new https_1.HttpsError("failed-precondition", "STREAM_BASE_URL not available.");
        const nowSec = Math.floor(Date.now() / 1000);
        const exp = nowSec + 5 * 60; // 5 minutes
        const token = jsonwebtoken_1.default.sign({
            sub: uid, // who
            mid: mediaId, // what
            iat: nowSec,
            exp,
            ver: 1, // version, handy for future changes
        }, privateKey, { algorithm: "RS256" });
        // 5) Build URL to your NAS HLS endpoint
        const baseUrl = baseUrlRaw.endsWith("/") ? baseUrlRaw.slice(0, -1) : baseUrlRaw;
        const url = `${baseUrl}/hls/${encodeURIComponent(mediaId)}/index.m3u8?token=${encodeURIComponent(token)}`;
        res.status(200).json({ url, expiresAt: exp });
    }
    catch (err) {
        logger.error("startPlayback error", err);
        const status = err?.httpErrorCode?.status || 500;
        res.status(status).json({ error: err?.message || "Internal error" });
    }
});
