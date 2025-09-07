
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { z } from 'zod';

const db = admin.firestore();

// -------- NEW: robust coercion to Firestore Timestamp --------
function toTimestamp(v: unknown): admin.firestore.Timestamp {
  try {
    if (v == null) return admin.firestore.Timestamp.now();
    // already a Firestore Timestamp
    if (v instanceof (admin.firestore as any).Timestamp) {
      return v as admin.firestore.Timestamp;
    }
    if (typeof v === 'number') {
      // treat as millis since epoch
      return admin.firestore.Timestamp.fromMillis(v);
    }
    if (typeof v === 'string') {
      // ISO 8601, or any Date-parsable string
      const d = new Date(v);
      if (!isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
      // fallback
      return admin.firestore.Timestamp.now();
    }
    // objects that expose .toDate()
    // @ts-ignore
    if (typeof v?.toDate === 'function') {
      // @ts-ignore
      const d = v.toDate();
      if (d instanceof Date && !isNaN(d.getTime())) {
        return admin.firestore.Timestamp.fromDate(d);
      }
    }
  } catch { /* noop */ }
  return admin.firestore.Timestamp.now();
}

// Zod schema for a single media item in the ingest payload.
const MediaItemSchema = z.object({
  mediaId: z.string().min(1).optional(),
  title: z.string().min(1, { message: 'Title cannot be empty' }),
  filename: z.string().min(1, { message: 'Filename cannot be empty' }),
  path: z.string().min(1, { message: 'Path cannot be empty' }),
  type: z.enum(['movie', 'episode']),
  season: z.number().int().nonnegative().optional(),
  episode: z.number().int().nonnegative().optional(),
  year: z.number().int().optional(),
  size: z.number().positive({ message: 'Size must be a positive number' }),
  duration: z.number().positive({ message: 'Duration must be a positive number' }),
  codec: z.string().optional(),
  posterUrl: z.string().url().optional(),
  backdropUrl: z.string().url().optional(),
  tmdbId: z.number().int().optional(),
  // -------- CHANGED: accept ISO string OR millis number --------
  addedAt: z.union([z.string().datetime({ message: 'Invalid ISO 8601 datetime format' }), z.number()]).optional()
});

// Zod schema for the entire agent ingest request body.
const AgentIngestBodySchema = z.object({
  items: z.array(MediaItemSchema).max(200, { message: 'Cannot process more than 200 items per request' })
});

// Zod schema for the flow input, combining API key and body.
const AgentIngestInputSchema = AgentIngestBodySchema.extend({
  apiKey: z.string().min(1, { message: 'API key is required' }),
});

/**
 * Compares two hex strings in constant time to prevent timing attacks.
 */
function timingSafeHexEquals(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) {
    // To prevent leaking length info, perform a dummy comparison.
    crypto.timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Computes the scrypt hash of a key with a given salt.
 */
function scryptHex(key: string, salt: string, length = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(key, salt, length, (err, derivedKey) => {
      if (err) return reject(err);
      resolve((derivedKey as Buffer).toString('hex'));
    });
  });
}

/**
 * Creates a stable, deterministic SHA-256 hash for a media item.
 */
function stableMediaId(serverId: string, path: string): string {
  const h = crypto.createHash('sha256');
  h.update(`${serverId}:${path}`);
  return h.digest('hex');
}

export type IngestResult = { mediaId?: string; status: 'upserted' | 'error'; message?: string; path?: string };

/**
 * Main flow for handling agent media ingest requests.
 */
export async function agentIngestFlow(rawInput: unknown): Promise<{ results: IngestResult[]; ownerUid: string | null; serverId: string | null }> {
  // 1. Validate the entire input including API key and items array.
  const parsedInput = AgentIngestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const errorMessages = parsedInput.error.issues.map(issue => issue.message).join(', ');
    const result: IngestResult = { status: 'error', message: `Invalid payload structure: ${errorMessages}` };
    return { results: [result], ownerUid: null, serverId: null };
  }

  const { apiKey, items } = parsedInput.data;

  // Optimization: if no items, do nothing.
  if (items.length === 0) {
    return { results: [], ownerUid: null, serverId: null };
  }

  // 2. Resolve the server by API key.
  const serversSnap = await db.collectionGroup('servers').where('status', '==', 'linked').get();

  let matchedRef: FirebaseFirestore.DocumentReference | null = null;
  let ownerUid: string | null = null;
  let serverId: string | null = null;

  for (const docSnap of serversSnap.docs) {
    const data = docSnap.data() as any;
    if (!data.apiKeyHash || !data.salt) continue;

    const computedHash = await scryptHex(apiKey, data.salt, 64);
    if (timingSafeHexEquals(computedHash, data.apiKeyHash)) {
      matchedRef = docSnap.ref;
      ownerUid = docSnap.ref.parent.parent?.id ?? null; // /users/{uid}/servers/{serverId}
      serverId = data.serverId || docSnap.ref.id;
      break; // Found our match
    }
  }

  if (!matchedRef || !ownerUid || !serverId) {
    const err: any = new Error('Invalid or unauthorized API key provided.');
    err.code = 'permission-denied';
    throw err;
  }

  // 3. Update the agent's last seen timestamp (fire-and-forget).
  matchedRef.update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() }).catch(e => console.error(`Failed to update lastSeen for ${serverId}`, e));

  // 4. Process items in batches.
  const BATCH_SIZE = 450; // Keep a margin below the 500-write limit.
  const results: IngestResult[] = [];
  let batch = db.batch();
  let opsInBatch = 0;

  for (const item of items) {
    try {
      // Re-validate each item individually to provide per-item error messages.
      MediaItemSchema.parse(item);

      const mid = item.mediaId || stableMediaId(serverId, item.path);
      const docRef = db.doc(`users/${ownerUid}/media/${mid}`);

      const dataToUpsert: any = {
        ...item,
        mediaId: mid,
        serverId,
        season: item.season ?? null,
        episode: item.episode ?? null,
        year: item.year ?? null,
        codec: item.codec ?? null,
        posterUrl: item.posterUrl ?? null,
        backdropUrl: item.backdropUrl ?? null,
        tmdbId: item.tmdbId ?? null,
        status: 'indexed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // -------- CHANGED: force addedAt to be a Firestore Timestamp when provided --------
      if (typeof item.addedAt !== 'undefined') {
        dataToUpsert.addedAt = toTimestamp(item.addedAt);
      }
      // If you want to *always* set addedAt on first create and never touch it again,
      // you can later add a try-create path for new docs. For now we only set when provided.

      batch.set(docRef, dataToUpsert, { merge: true });
      opsInBatch++;
      results.push({ mediaId: mid, status: 'upserted', path: item.path });

      if (opsInBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch(); // Start a new batch
        opsInBatch = 0;
      }
    } catch (e: any) {
      // If an individual item fails validation or processing.
      const message = e instanceof z.ZodError ? JSON.stringify(e.issues) : (e.message || 'Unknown processing error');
      results.push({ status: 'error', message, path: (item as any)?.path });
    }
  }

  // Commit any remaining writes in the last batch.
  if (opsInBatch > 0) {
    await batch.commit();
  }

  return { results, ownerUid, serverId };
}
