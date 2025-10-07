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
// functions/triggerAgentSync.ts
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const initFirebase_1 = require("./initFirebase");
if (!admin.apps.length)
    admin.initializeApp();
const corsHandler = (0, cors_1.default)({ origin: true });
exports.default = functions
    .runWith({ timeoutSeconds: 30, memory: "256MB" })
    .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        try {
            // Only POST
            if (req.method !== "POST") {
                return res.status(405).json({ error: { code: "method-not-allowed", message: "Use POST" } });
            }
            // --- Auth ---
            const authHeader = req.headers.authorization || "";
            if (!authHeader.startsWith("Bearer ")) {
                throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
            }
            const idToken = authHeader.substring("Bearer ".length);
            const decoded = await admin.auth().verifyIdToken(idToken);
            const uid = decoded?.uid;
            if (!uid) {
                throw new functions.https.HttpsError("unauthenticated", "Invalid ID token.");
            }
            // --- Inputs ---
            const { serverId, librarySection } = req.body || {};
            if (!serverId || typeof serverId !== "string") {
                throw new functions.https.HttpsError("invalid-argument", "Missing or invalid 'serverId'.");
            }
            if (librarySection && librarySection !== "movies" && librarySection !== "tv") {
                throw new functions.https.HttpsError("invalid-argument", "librarySection must be 'movies' or 'tv' if provided.");
            }
            // (Optional) Verify server exists & belongs to user (keeps UX honest)
            const serverRef = initFirebase_1.db.doc(`users/${uid}/servers/${serverId}`);
            const serverSnap = await serverRef.get();
            if (!serverSnap.exists) {
                throw new functions.https.HttpsError("not-found", `Server '${serverId}' not found for user.`);
            }
            // --- Create job document for agent to pick up ---
            // Agent should poll/watch users/{uid}/agentJobs where status == "queued" and serverId matches its own identity.
            const jobRef = initFirebase_1.db.collection(`users/${uid}/agentJobs`).doc();
            const now = admin.firestore.FieldValue.serverTimestamp();
            // Build the payload carefully: NEVER include undefined Firestore values.
            const jobPayload = {
                action: "sync", // tells the agent what to do
                status: "queued", // queued -> running -> done/error
                serverId, // address the job to a specific agent
                createdAt: now,
                updatedAt: now,
                createdBy: uid,
                // optional filters
                librarySection: librarySection ?? null,
                // optional progress scaffold
                progress: { scanned: 0, upserted: 0, skipped: 0, errors: 0 },
            };
            await jobRef.set(jobPayload, { merge: false });
            // Return job info so UI can subscribe/poll for status
            return res.status(200).json({
                jobId: jobRef.id,
                status: "queued",
                serverId,
                librarySection: librarySection ?? null,
            });
        }
        catch (err) {
            functions.logger.error("triggerAgentSync error", err);
            const code = err?.code || "internal";
            const message = err?.message || "Internal error.";
            const http = code === "unauthenticated" ? 401 :
                code === "permission-denied" ? 403 :
                    code === "not-found" ? 404 :
                        code === "invalid-argument" ? 400 :
                            500;
            return res.status(http).json({ error: { code, message } });
        }
    });
});
