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
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const initFirebase_1 = require("./initFirebase");
const corsHandler = (0, cors_1.default)({ origin: true });
exports.default = functions.https.onRequest((req, res) => {
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
            const { collection, docId, posterUrl, backdropUrl, videoLink } = req.body || {};
            if (!collection || !docId) {
                throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: collection and docId.');
            }
            const docRef = initFirebase_1.db.doc(`${collection}/${docId}`);
            const updatePayload = {};
            const lockedFields = [];
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
            if (Object.keys(updatePayload).length === 0) {
                throw new functions.https.HttpsError('invalid-argument', 'No fields to update.');
            }
            // Use firebase-admin's FieldValue
            updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await docRef.update(updatePayload);
            res.status(200).json({ ok: true, docId, locked: lockedFields });
        }
        catch (error) {
            functions.logger.error('Error in tmdbManualSet:', error);
            const code = error.code || 'internal';
            const message = error.message || 'An internal error occurred.';
            const httpStatus = code === 'unauthenticated' ? 401 :
                code === 'invalid-argument' ? 400 : 500;
            // Ensure CORS headers even on errors
            res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.status(httpStatus).json({ error: { code, message } });
        }
    });
});
