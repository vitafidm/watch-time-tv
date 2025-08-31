// src/functions/flows/claim-token-flow.ts
import * as crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, db } from '../lib/admin';

/**
 * Encapsulates the business logic for creating a server claim token.
 * This includes rate-limiting, generating secure tokens, and writing to Firestore.
 * @param uid The authenticated user's ID.
 * @returns A flat object with the claim details for the client.
 */
export async function createClaimTokenFlow(uid: string) {
  // 1) Rate-limit: one token per 30 seconds per user
  const metaRef = db.doc(`users/${uid}/servers_meta/rateLimit`);
  const metaSnap = await metaRef.get();
  const now = new Date();

  if (metaSnap.exists) {
    const data = metaSnap.data()!;
    const until: Date | undefined =
      (data.rateLimitedUntil?.toDate?.() as Date | undefined) ?? data.rateLimitedUntil;
    if (until && now < until) {
      const err: any = new Error(
        'A pending claim token was created recently. Please try again shortly.'
      );
      err.name = 'RateLimitError';
      // Optional: surface a code your HTTP layer can map to 429
      err.code = 'resource-exhausted';
      throw err;
    }
  }

  // 2) Generate secure IDs
  const serverId = crypto.randomUUID();
  const claimPublicId = `pub-${crypto.randomBytes(12).toString('hex')}`;
  const claimSecret = `sec-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  // 3) HMAC signature of (publicId:secret). We store only the signature.
  const hmacKey = process.env.HMAC_SECRET;
  if (!hmacKey) {
    const err: any = new Error('Server configuration error: HMAC_SECRET is not set.');
    err.code = 'failed-precondition';
    throw err;
  }

  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(`${claimPublicId}:${claimSecret}`);
  const claimSignature = hmac.digest('hex');

  // 4) Write pending server doc
  const serverRef = db.doc(`users/${uid}/servers/${serverId}`);
  await serverRef.set({
    status: 'pending',
    serverId,
    claimPublicId,
    claimSignature,                // store signature, never the secret
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  // 5) Persist rate-limit meta
  const rateLimitedUntil = new Date(now.getTime() + 30 * 1000); // 30s cooldown
  await metaRef.set(
    {
      lastTokenCreatedAt: Timestamp.now(),
      rateLimitedUntil: Timestamp.fromDate(rateLimitedUntil),
    },
    { merge: true }
  );

  // 6) Return flat response (secret only returned to the client)
  return {
    serverId,
    claimPublicId,
    claimSecret,
    expiresAtISO: expiresAt.toISOString(),
  };
}
