
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { normalizeTitle } from '../lib/normalizeTitle';
import { parseEpisodeFromName } from '../lib/episodeParser';

const db = admin.firestore();

function toTimestamp(v: unknown): admin.firestore.Timestamp {
  try {
    if (v == null) return admin.firestore.Timestamp.now();
    if (v instanceof (admin.firestore as any).Timestamp) return v as admin.firestore.Timestamp;
    if (typeof v === 'number') return admin.firestore.Timestamp.fromMillis(v);
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
      return admin.firestore.Timestamp.now();
    }
    // @ts-ignore
    if (typeof v?.toDate === 'function') {
      // @ts-ignore
      const d = v.toDate();
      if (d instanceof Date && !isNaN(d.getTime())) {
        return admin.firestore.Timestamp.fromDate(d);
      }
    }
  } catch {}
  return admin.firestore.Timestamp.now();
}

// ---------- NEW: lightweight scoring (no TMDB calls) ----------
function scoreMovie({
  normalizedTitle,
  year,
  filename,
}: { normalizedTitle: string | null; year?: number | null; filename: string }) {
  // crude heuristic:
  // base 0.5 if we have a normalized title, +0.3 if we have a 4-digit plausible year in the name or provided,
  // +0.15 if filename had a (YYYY) pattern, ceil at 0.95
  let score = 0;
  if (normalizedTitle && normalizedTitle.length >= 3) score += 0.5;

  const yearInName = /\b(19|20)\d{2}\b/.test(filename);
  if (year || yearInName) score += 0.3;

  const parenYear = /\((19|20)\d{2}\)/.test(filename);
  if (parenYear) score += 0.15;

  return Math.min(0.95, score);
}

function scoreEpisode({
  season,
  episode,
  filename,
}: { season: number | null; episode: number | null; filename: string }) {
  // 0.95 if S/E are present and look sane; 0.6 if only one is present
  if (Number.isInteger(season) && Number.isInteger(episode)) return 0.95;
  if (Number.isInteger(season) || Number.isInteger(episode)) return 0.6;
  // fallback: detect token in filename
  if (/s\d{1,2}e\d{1,3}/i.test(filename)) return 0.8;
  return 0.25;
}

// Zod schemas
const MediaItemSchema = z.object({
  mediaId: z.string().min(1).optional(),
  title: z.string().min(1),
  filename: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(['movie', 'episode']),
  season: z.number().int().nonnegative().optional(),
  episode: z.number().int().nonnegative().optional(),
  year: z.number().int().optional(),
  size: z.number().positive(),
  duration: z.number().positive(),
  codec: z.string().optional(),
  posterUrl: z.string().url().optional(),
  backdropUrl: z.string().url().optional(),
  tmdbId: z.number().int().optional(),
  addedAt: z.union([z.string().datetime(), z.number()]).optional(),

  // helper fields (server-computed)
  librarySection: z.enum(['movies','tv']).optional(),
  normalizedTitle: z.string().nullable().optional(),
  episodeNumber: z.number().int().nullable().optional(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  matchMethod: z.enum(['title+year','show+S/E','manual']).nullable().optional(),
  manualOverride: z.boolean().optional(),
});

const AgentIngestBodySchema = z.object({
  items: z.array(MediaItemSchema).max(200)
});

const AgentIngestInputSchema = AgentIngestBodySchema.extend({
  apiKey: z.string().min(1),
});

function timingSafeHexEquals(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function scryptHex(key: string, salt: string, length = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(key, salt, length, (err, derivedKey) => {
      if (err) return reject(err);
      resolve((derivedKey as Buffer).toString('hex'));
    });
  });
}

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

export async function agentIngestFlow(rawInput: unknown): Promise<{ results: IngestResult[]; ownerUid: string | null; serverId: string | null }> {
  const parsedInput = AgentIngestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const errorMessages = parsedInput.error.issues.map(issue => issue.message).join(', ');
    const result: IngestResult = { status: 'error', message: `Invalid payload structure: ${errorMessages}` };
    return { results: [result], ownerUid: null, serverId: null };
  }

  const { apiKey, items } = parsedInput.data;
  if (items.length === 0) return { results: [], ownerUid: null, serverId: null };

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

  matchedRef.update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});

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
      
      if (dataToUpsert.tmdbId === undefined) {
        dataToUpsert.tmdbId = null;
      }

      if (typeof item.addedAt !== 'undefined') {
        dataToUpsert.addedAt = toTimestamp(item.addedAt);
      }

      const recomputeHelpers = !existingDoc || existingDoc.type !== item.type;

      // librarySection
      if (recomputeHelpers || existingDoc.librarySection === undefined) {
        dataToUpsert.librarySection = deriveLibrarySection(item.path);
      }

      if (item.type === 'episode') {
        // season/episodeNumber parse
        if (recomputeHelpers || existingDoc.season === undefined || existingDoc.episodeNumber === undefined) {
          const parsed = parseEpisodeFromName(item.filename);
          dataToUpsert.season = parsed.season;
          dataToUpsert.episodeNumber = parsed.episodeNumber;
        }
        if (recomputeHelpers || existingDoc.normalizedTitle === undefined) {
          dataToUpsert.normalizedTitle = null; // episodes keep null here
        }

        // scoring (only if not set already)
        if (existingDoc?.matchConfidence === undefined || existingDoc?.matchMethod === undefined) {
          const s = scoreEpisode({
            season: dataToUpsert.season ?? null,
            episode: dataToUpsert.episodeNumber ?? null,
            filename: item.filename,
          });
          dataToUpsert.matchConfidence = s;
          dataToUpsert.matchMethod = (Number.isInteger(dataToUpsert.season) && Number.isInteger(dataToUpsert.episodeNumber)) ? 'show+S/E' : null;
        }

      } else {
        // movie
        if (recomputeHelpers || existingDoc.normalizedTitle === undefined) {
          dataToUpsert.normalizedTitle = normalizeTitle({ filename: item.filename, path: item.path, type: 'movie', year: item.year ?? null });
        }
        if (recomputeHelpers || existingDoc.season === undefined || existingDoc.episodeNumber === undefined) {
          dataToUpsert.season = null;
          dataToUpsert.episodeNumber = null;
        }

        // scoring (only if not set already)
        if (existingDoc?.matchConfidence === undefined || existingDoc?.matchMethod === undefined) {
          const s = scoreMovie({
            normalizedTitle: dataToUpsert.normalizedTitle ?? null,
            year: item.year ?? null,
            filename: item.filename,
          });
          dataToUpsert.matchConfidence = s || null;
          dataToUpsert.matchMethod = dataToUpsert.normalizedTitle ? 'title+year' : null;
        }
      }

      if (existingDoc?.manualOverride === undefined) dataToUpsert.manualOverride = false;
      if (existingDoc?.matchConfidence === undefined && dataToUpsert.matchConfidence === undefined) dataToUpsert.matchConfidence = null;
      if (existingDoc?.matchMethod === undefined && dataToUpsert.matchMethod === undefined) dataToUpsert.matchMethod = null;

      batch.set(docRef, dataToUpsert, { merge: true });
      opsInBatch++;
      results.push({ mediaId: mid, status: 'upserted', path: item.path });

      if (opsInBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    } catch (e: any) {
      results.push({ status: 'error', message: e?.message || 'Unknown processing error', path: (item as any)?.path });
    }
  }

  if (opsInBatch > 0) await batch.commit();
  return { results, ownerUid, serverId };
}
