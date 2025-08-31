// src/functions/flows/agent-claim-flow.ts
import * as crypto from 'crypto';
import { promisify } from 'util';
import { admin, db } from '../lib/admin';

type ClaimInput = {
  claimPublicId: string;
  claimSecret: string;
  agentName?: string;
  agentVersion?: string;
  requesterIp?: string | null;
};

const scryptAsync = promisify(crypto.scrypt);

/**
 * Constant-time HMAC verification of (claimPublicId:claimSecret) using server secret.
 * Prevents timing attacks and avoids leaking length differences.
 */
function hmacValid(pub: string, sec: string, secret: string, expectedHex: string): boolean {
  const h = crypto.createHmac('sha256', secret);
  h.update(`${pub}:${sec}`);
  const sigHex = h.digest('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(sigHex, 'hex');

  // If lengths differ, compare against a zeroed buffer of expected length to equalize timing.
  if (actual.length !== expected.length) {
    try {
      crypto.timingSafeEqual(Buffer.alloc(expected.length, 0), expected);
    } catch {
      /* noop — just equalize timing */
    }
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

export async function agentClaimFlow(input: ClaimInput) {
  const { claimPublicId, claimSecret, agentName, agentVersion, requesterIp } = input;

  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    const err: any = new Error('Server configuration error: HMAC_SECRET is not set.');
    err.code = 'failed-precondition';
    throw err;
  }

  // 1) Locate pending server by claimPublicId (unknown owner, so use collectionGroup)
  const q = await db
    .collectionGroup('servers')
    .where('status', '==', 'pending')
    .where('claimPublicId', '==', claimPublicId)
    .limit(1)
    .get();

  if (q.empty) {
    const err: any = new Error('Invalid or already used claim token.');
    // 403 prevents leaking existence of tokens
    err.code = 'permission-denied';
    throw err;
  }

  const snap = q.docs[0];
  const serverRef = snap.ref;
  const serverData = snap.data() as any;

  // 2) Verify HMAC signature
  const ok = hmacValid(claimPublicId, claimSecret, hmacSecret, serverData.claimSignature);
  if (!ok) {
    const err: any = new Error('Invalid claim token signature.');
    err.code = 'permission-denied';
    throw err;
  }

  // 3) TTL check
  const expiresAt: Date | null = serverData.expiresAt?.toDate?.() ?? null;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    const err: any = new Error('This claim token has expired.');
    // Your HTTP wrapper maps this to 410 Gone
    err.code = 'failed-precondition';
    throw err;
  }

  // 4) Single-use check
  if (serverData.status !== 'pending') {
    const err: any = new Error('This claim token has already been used.');
    err.code = 'already-exists'; // 409 Conflict
    throw err;
  }

  // 5) Generate permanent agent API key and hash with scrypt
  const agentApiKey = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(agentApiKey, salt, 64)) as Buffer;
  const apiKeyHash = derived.toString('hex');

  // 6) Atomically update server doc to 'linked' and clear temp fields
  await serverRef.update({
    status: 'linked',
    name: agentName ?? 'New Agent',
    agentVersion: agentVersion ?? null,
    ip: requesterIp ?? null,
    apiKeyHash,
    salt,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    // Invalidate token
    claimPublicId: null,
    claimSignature: null,
    expiresAt: null,
  });

  const serverId: string = serverData.serverId || serverRef.id;

  // 7) Return the plaintext API key ONCE (agent must store securely)
  return { agentApiKey, serverId };
}
