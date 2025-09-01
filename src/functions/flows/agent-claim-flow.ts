
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';

type ClaimInput = {
  claimPublicId: string;
  claimSecret: string;
  agentName?: string;
  agentVersion?: string;
  requesterIp?: string | null;
};

const db = admin.firestore();

/**
 * Performs a constant-time comparison of two hex strings to prevent timing attacks.
 */
function hmacValid(pub: string, sec: string, secret: string, expectedHex: string) {
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


export async function agentClaimFlow(input: ClaimInput) {
  const { claimPublicId, claimSecret, agentName, agentVersion, requesterIp } = input;
  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    console.error('HMAC_SECRET environment variable is not set.');
    throw new Error('Server configuration error.');
  }

  // 1. Find the pending server doc by its public claim ID. This is a collectionGroup
  // query because we don't know the user's UID.
  const q = await db.collectionGroup('servers')
    .where('status', '==', 'pending')
    .where('claimPublicId', '==', claimPublicId)
    .limit(1)
    .get();

  if (q.empty) {
    const err: any = new Error('Invalid or already used claim token.');
    err.code = 'permission-denied'; // Use 403 to avoid leaking existence info
    throw err;
  }

  const snap = q.docs[0];
  const serverRef = snap.ref;
  const serverData = snap.data() as any;

  // 2. Security Check: Verify the HMAC signature.
  const signatureOk = hmacValid(claimPublicId, claimSecret, hmacSecret, serverData.claimSignature);
  if (!signatureOk) {
    const err: any = new Error('Invalid claim token signature.');
    err.code = 'permission-denied';
    throw err;
  }

  // 3. Security Check: Ensure the token has not expired.
  const expiresAt = serverData.expiresAt?.toDate?.() ?? null;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    const err: any = new Error('This claim token has expired.');
    err.code = 'failed-precondition'; // Maps to 410 Gone
    throw err;
  }

  // 4. Security Check: Ensure the token hasn't already been used.
  if (serverData.status !== 'pending') {
    const err: any = new Error('This claim token has already been used.');
    err.code = 'already-exists'; // Maps to 409 Conflict
    throw err;
  }

  // 5. Generate and hash the permanent agent API key.
  const agentApiKey = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const scryptHash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(agentApiKey, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve((derivedKey as Buffer).toString('hex'));
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
