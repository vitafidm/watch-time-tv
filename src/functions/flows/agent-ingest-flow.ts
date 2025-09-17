
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { normalizeTitle } from '../src/lib/normalizeTitle';
import { parseEpisodeFromName } from '../src/lib/episodeParser';

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
  addedAt: z.union([z.string().datetime({ message: 'Invalid ISO 8601 datetime format' }), z.number()]).optional(),
  
  // New optional fields (server-computed)
  librarySection: z.enum(['movies','tv']).optional(),
  normalizedTitle: z.string().nullable().optional(),
  episodeNumber: z.number().int().nullable().optional(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  matchMethod: z.enum(['title+year','show+S/E','manual']).nullable().optional(),
  manualOverride: z.boolean().optional(),
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

function deriveLibrarySection(path: string): 'movies' | 'tv' | undefined {
    const segments = path.toLowerCase().split(/[\\/]/);
    if (segments.includes('movies')) return 'movies';
    if (segments.includes('tv')) return 'tv';
    return undefined;
}


export type IngestResult = { mediaId?: string; status: 'upserted' | 'error'; message?: string; path?: string };

/**
 * Main flow for handling agent media ingest requests.
 */
export async function agentIngestFlow(rawInput: unknown): Promise<{ results: IngestResult[]; ownerUid: string | null; serverId: string | null }> {
  const parsedInput = AgentIngestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const errorMessages = parsedInput.error.issues.map(issue => issue.message).join(', ');
    const result: IngestResult = { status: 'error', message: `Invalid payload structure: ${errorMessages}` };
    return { results: [result], ownerUid: null, serverId: null };
  }

  const { apiKey, items } = parsedInput.data;

  if (items.length === 0) {
    return { results: [], ownerUid: null, serverId: null };
  }

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
      ownerUid = docSnap.ref.parent.parent?.id ?? null;
      serverId = data.serverId || docSnap.ref.id;
      break;
    }
  }

  if (!matchedRef || !ownerUid || !serverId) {
    const err: any = new Error('Invalid or unauthorized API key provided.');
    err.code = 'permission-denied';
    throw err;
  }

  matchedRef.update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() }).catch(e => console.error(`Failed to update lastSeen for ${serverId}`, e));

  const BATCH_SIZE = 450;
  const results: IngestResult[] = [];
  let batch = db.batch();
  let opsInBatch = 0;

  for (const item of items) {
    try {
      MediaItemSchema.parse(item);

      const mid = item.mediaId || stableMediaId(serverId, item.path);
      const docRef = db.doc(`users/${ownerUid}/media/${mid}`);
      
      const existingDoc = await docRef.get().then(s => s.exists ? s.data() : null);

      const dataToUpsert: any = {
        ...item,
        mediaId: mid,
        serverId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      if (typeof item.addedAt !== 'undefined') {
        dataToUpsert.addedAt = toTimestamp(item.addedAt);
      }

      // --- NEW FIELD DERIVATION ---
      const recomputeHelpers = !existingDoc || existingDoc.type !== item.type;
      
      if (recomputeHelpers || existingDoc.librarySection === undefined) {
          dataToUpsert.librarySection = deriveLibrarySection(item.path);
      }

      if (item.type === 'episode') {
        if (recomputeHelpers || existingDoc.season === undefined || existingDoc.episodeNumber === undefined) {
            const parsed = parseEpisodeFromName(item.filename);
            dataToUpsert.season = parsed.season;
            dataToUpsert.episodeNumber = parsed.episodeNumber;
        }
        if (recomputeHelpers || existingDoc.normalizedTitle === undefined) {
            dataToUpsert.normalizedTitle = null;
        }
      } else if (item.type === 'movie') {
        if (recomputeHelpers || existingDoc.normalizedTitle === undefined) {
           dataToUpsert.normalizedTitle = normalizeTitle({ ...item });
        }
        if (recomputeHelpers || existingDoc.season === undefined || existingDoc.episodeNumber === undefined) {
            dataToUpsert.season = null;
            dataToUpsert.episodeNumber = null;
        }
      }
      
      if (existingDoc?.matchConfidence === undefined) dataToUpsert.matchConfidence = null;
      if (existingDoc?.matchMethod === undefined) dataToUpsert.matchMethod = null;
      if (existingDoc?.manualOverride === undefined) dataToUpsert.manualOverride = false;
      
      // --- END NEW FIELD DERIVATION ---

      batch.set(docRef, dataToUpsert, { merge: true });
      opsInBatch++;
      results.push({ mediaId: mid, status: 'upserted', path: item.path });
      
      console.log(`Ingest: mediaId=${mid} type=${item.type} lib=${dataToUpsert.librarySection || '-'} normTitle=${dataToUpsert.normalizedTitle || '-'} S=${dataToUpsert.season ?? '-'} E=${dataToUpsert.episodeNumber ?? '-'}`);


      if (opsInBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    } catch (e: any) {
      const message = e instanceof z.ZodError ? JSON.stringify(e.issues) : (e.message || 'Unknown processing error');
      results.push({ status: 'error', message, path: (item as any)?.path });
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  return { results, ownerUid, serverId };
}
