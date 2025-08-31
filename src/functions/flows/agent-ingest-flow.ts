// src/functions/flows/agent-ingest-flow.ts
import * as crypto from 'crypto';
import { promisify } from 'util';
import { z } from 'zod';
import { admin, db } from '../lib/admin';

const scryptAsync = promisify(crypto.scrypt);

// ---- Validation Schemas ----
const MediaItemSchema = z.object({
  mediaId: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(['movie', 'episode']),
  year: z.number().optional(),
  size: z.number().positive().optional(),     // allow missing, if your agent doesn't always send
  duration: z.number().positive().optional(), // same here
  addedAt: z.string().optional(),             // ISO timestamp if present
});

const AgentIngestInputSchema = z.object({
  apiKey: z.string().min(1),
  items: z.array(MediaItemSchema).min(1).max(500),
});

type AgentIngestInput = z.infer<typeof AgentIngestInputSchema>;

type ResultRow =
  | { mediaId: string; status: 'upserted' }
  | { mediaId: string; status: 'error'; message: string };

// ---- Helpers ----

// Constant-time equality for hex strings
function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) {
    // equalize timing even if lengths differ
    try { crypto.timingSafeEqual(a, Buffer.alloc(b.length, 0)); } catch {}
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve owner UID and server record by API key.
 * We search collectionGroup('servers') for linked servers and scrypt-verify the provided key.
 */
async function resolveOwnerByApiKey(apiKey: string): Promise<{
  ownerUid: string;
  serverId: string;
  serverPath: string; // users/{uid}/servers/{serverId}
} | null> {
  // Find candidate linked servers (small scans are fine; you can add indexing if needed)
  const q = await db
    .collectionGroup('servers')
    .where('status', '==', 'linked')
    .limit(50)
    .get();

  for (const docSnap of q.docs) {
    const data = docSnap.data() as any;
    if (!data?.apiKeyHash || !data?.salt) continue;

    const derived = (await scryptAsync(apiKey, String(data.salt), 64)) as Buffer;
    const derivedHex = derived.toString('hex');

    if (timingSafeHexEqual(derivedHex, String(data.apiKeyHash))) {
      // users/{uid}/servers/{serverId}  -> parent.parent is users/{uid}
      const serverPath = docSnap.ref.path;
      const segs = serverPath.split('/'); // ["users", "{uid}", "servers", "{serverId}"]
      const ownerUid = segs[1];
      const serverId = segs[3] ?? docSnap.id;
      if (ownerUid) {
        return { ownerUid, serverId, serverPath };
      }
    }
  }
  return null;
}

// ---- Flow ----

export async function agentIngestFlow(rawBody: unknown): Promise<{ results: ResultRow[] }> {
  const parsed = AgentIngestInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    const err: any = new Error(JSON.stringify(parsed.error.issues));
    err.code = 'invalid-argument';
    throw err;
  }

  const { apiKey, items } = parsed.data as AgentIngestInput;

  // Authenticate agent key → resolve owner uid
  const resolved = await resolveOwnerByApiKey(apiKey);
  if (!resolved) {
    const err: any = new Error('Invalid or unauthorized API key.');
    err.code = 'permission-denied';
    throw err;
  }

  const { ownerUid, serverId } = resolved;

  const batch = db.batch();
  const results: ResultRow[] = [];

  for (const it of items) {
    try {
      const mediaRef = db.doc(`users/${ownerUid}/media/${it.mediaId}`);
      const payload: Record<string, any> = {
        mediaId: it.mediaId,
        title: it.title,
        filename: it.filename,
        path: it.path,
        type: it.type,                // 'movie' | 'episode'
        year: it.year ?? null,
        size: it.size ?? null,
        duration: it.duration ?? null,
        serverId,
        status: 'indexed',
        addedAt: it.addedAt ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // you can also add agent/source marker fields here if useful
      };

      batch.set(mediaRef, payload, { merge: true });
      results.push({ mediaId: it.mediaId, status: 'upserted' });
    } catch (e: any) {
      results.push({
        mediaId: it.mediaId,
        status: 'error',
        message: e?.message ?? 'unknown error',
      });
    }
  }

  try {
    await batch.commit();
  } catch (e: any) {
    // If commit fails, convert all optimistic 'upserted' to errors to be explicit
    const msg = e?.message ?? 'batch commit failed';
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'upserted') {
        results[i] = { mediaId: (results[i] as any).mediaId, status: 'error', message: msg };
      }
    }
  }

  return { results };
}
