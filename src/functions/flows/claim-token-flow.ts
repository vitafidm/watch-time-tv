
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

/**
 * Encapsulates the business logic for creating a server claim token.
 * This includes rate-limiting, generating secure tokens, and writing to Firestore.
 * @param uid The authenticated user's ID.
 * @returns A flat object with the claim details for the client.
 */
export async function createClaimTokenFlow(uid: string) {
  // 1. Rate-Limit Check: Prevent abuse by limiting token creation to one per 30s.
  const metaRef = db.doc(`users/${uid}/servers_meta/rateLimit`);
  const metaSnap = await metaRef.get();
  const now = new Date();

  if (metaSnap.exists) {
    const data = metaSnap.data()!;
    // Timestamps can be retrieved as `Timestamp` objects or JS `Date` objects.
    // Handle both cases for robustness.
    const until = data.rateLimitedUntil?.toDate?.() ?? data.rateLimitedUntil;
    if (until && now < until) {
      const err: any = new Error(
        'A pending claim token was created recently. Please try again shortly.'
      );
      err.name = 'RateLimitError';
      throw err;
    }
  }

  // 2. Generate secure, random IDs for the claim process.
  const serverId = crypto.randomUUID();
  const claimPublicId = `pub-${crypto.randomBytes(12).toString('hex')}`;
  const claimSecret = `sec-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minute TTL

  // 3. Create HMAC Signature: The secret is never stored.
  // We store a signature of the public ID and secret, which the agent must
  // reproduce to prove it has the secret.
  const hmacKey = process.env.HMAC_SECRET;
  if (!hmacKey) {
    console.error('HMAC_SECRET environment variable is not set.');
    throw new Error('Server configuration error.');
  }

  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(`${claimPublicId}:${claimSecret}`);
  const claimSignature = hmac.digest('hex');

  // 4. Write Pending Server Doc to Firestore.
  // This document represents the user's intent to link a new server.
  const serverRef = db.doc(`users/${uid}/servers/${serverId}`);
  await serverRef.set({
    status: 'pending',
    serverId,
    claimPublicId,
    claimSignature,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  // 5. Write Rate-Limit Meta Doc to Firestore.
  const rateLimitedUntil = new Date(now.getTime() + 30 * 1000); // 30 second cooldown
  await metaRef.set({
    lastTokenCreatedAt: Timestamp.now(),
    rateLimitedUntil: Timestamp.fromDate(rateLimitedUntil),
  });

  // 6. Return the flat response object to the client.
  // The client receives the secret, but we do not.
  return {
    serverId,
    claimPublicId,
    claimSecret,
    expiresAtISO: expiresAt.toISOString(),
  };
}
