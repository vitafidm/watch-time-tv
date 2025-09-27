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
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentClaimFlow = agentClaimFlow;
const crypto = __importStar(require("crypto"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
/**
 * Performs a constant-time comparison of two hex strings to prevent timing attacks.
 */
function hmacValid(pub, sec, secret, expectedHex) {
    const h = crypto.createHmac('sha256', secret);
    h.update(`${pub}:${sec}`);
    const sig = h.digest('hex');
    // Ensure buffers have the same length to prevent length-leakage.
    const expectedBuffer = Buffer.from(expectedHex, 'hex');
    const sigBuffer = Buffer.from(sig, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) {
        // To mitigate timing attacks, we can perform a dummy comparison on a buffer of the same size.
        // This is arguably overkill if the attacker cannot control the length of expectedHex,
        // but it's a good practice.
        crypto.timingSafeEqual(sigBuffer, Buffer.alloc(sigBuffer.length));
        return false; // Explicitly return false if lengths differ
    }
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
async function agentClaimFlow(input) {
    const { claimPublicId, claimSecret, agentName, agentVersion, requesterIp } = input;
    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
        console.error('HMAC_SECRET environment variable is not set.');
        const err = new Error('Server configuration error: HMAC_SECRET is not set.');
        err.code = 'internal-config'; // Specific code for the handler to catch
        throw err;
    }
    // 1. Find the pending server doc by its public claim ID. This is a collectionGroup
    // query because we don't know the user's UID.
    const q = await db.collectionGroup('servers')
        .where('status', '==', 'pending')
        .where('claimPublicId', '==', claimPublicId)
        .limit(1)
        .get();
    if (q.empty) {
        const err = new Error('Invalid or already used claim token.');
        err.code = 'permission-denied'; // Use 403 to avoid leaking existence info
        throw err;
    }
    const snap = q.docs[0];
    const serverRef = snap.ref;
    const serverData = snap.data();
    // **NEW VALIDATION BLOCK**
    // Add robust checks to prevent crashes from malformed documents.
    if (!serverData || !serverData.claimSignature || !serverData.expiresAt) {
        console.error(`Malformed pending server document found for claimPublicId: ${claimPublicId}. Doc path: ${serverRef.path}`);
        const err = new Error('Invalid claim token state. The document is malformed.');
        err.code = 'permission-denied'; // Treat as invalid token to prevent info leakage
        throw err;
    }
    // **END NEW VALIDATION BLOCK**
    // 2. Security Check: Verify the HMAC signature.
    const signatureOk = hmacValid(claimPublicId, claimSecret, hmacSecret, serverData.claimSignature);
    if (!signatureOk) {
        const err = new Error('Invalid claim token signature.');
        err.code = 'permission-denied';
        throw err;
    }
    // 3. Security Check: Ensure the token has not expired.
    const expiresAt = serverData.expiresAt?.toDate?.() ?? null;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
        const err = new Error('This claim token has expired.');
        err.code = 'failed-precondition'; // Maps to 410 Gone
        throw err;
    }
    // 4. Security Check: Ensure the token hasn't already been used.
    if (serverData.status !== 'pending') {
        const err = new Error('This claim token has already been used.');
        err.code = 'already-exists'; // Maps to 409 Conflict
        throw err;
    }
    // 5. Generate and hash the permanent agent API key.
    const agentApiKey = crypto.randomBytes(32).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const scryptHash = await new Promise((resolve, reject) => {
        crypto.scrypt(agentApiKey, salt, 64, (err, derivedKey) => {
            if (err)
                return reject(err);
            resolve(derivedKey.toString('hex'));
        });
    });
    // 6. Atomically update the server document to its 'linked' state.
    await serverRef.update({
        status: 'linked',
        name: agentName ?? 'New Agent',
        apiKeyHash: scryptHash,
        salt,
        ip: requesterIp ?? null,
        agentVersion: agentVersion ?? null,
        linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Clear temporary claim fields
        claimPublicId: null,
        claimSignature: null,
        expiresAt: null,
    });
    const serverId = serverData.serverId || serverRef.id;
    // 7. Return the plaintext API key ONCE. The agent must store this securely.
    return { agentApiKey, serverId };
}
