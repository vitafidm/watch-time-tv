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
exports.agentIngestFlow = agentIngestFlow;
const crypto = __importStar(require("crypto"));
const admin = __importStar(require("firebase-admin"));
const zod_1 = require("zod");
const normalizeTitle_1 = require("../lib/normalizeTitle");
const episodeParser_1 = require("../lib/episodeParser");
const db = admin.firestore();
function toTimestamp(v) {
    try {
        if (v == null)
            return admin.firestore.Timestamp.now();
        if (v instanceof admin.firestore.Timestamp)
            return v;
        if (typeof v === 'number')
            return admin.firestore.Timestamp.fromMillis(v);
        if (typeof v === 'string') {
            const d = new Date(v);
            if (!isNaN(d.getTime()))
                return admin.firestore.Timestamp.fromDate(d);
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
    }
    catch { }
    return admin.firestore.Timestamp.now();
}
// ---------- NEW: lightweight scoring (no TMDB calls) ----------
function scoreMovie({ normalizedTitle, year, filename, }) {
    // crude heuristic:
    // base 0.5 if we have a normalized title, +0.3 if we have a 4-digit plausible year in the name or provided,
    // +0.15 if filename had a (YYYY) pattern, ceil at 0.95
    let score = 0;
    if (normalizedTitle && normalizedTitle.length >= 3)
        score += 0.5;
    const yearInName = /\b(19|20)\d{2}\b/.test(filename);
    if (year || yearInName)
        score += 0.3;
    const parenYear = /\((19|20)\d{2}\)/.test(filename);
    if (parenYear)
        score += 0.15;
    return Math.min(0.95, score);
}
function scoreEpisode({ season, episode, filename, }) {
    // 0.95 if S/E are present and look sane; 0.6 if only one is present
    if (Number.isInteger(season) && Number.isInteger(episode))
        return 0.95;
    if (Number.isInteger(season) || Number.isInteger(episode))
        return 0.6;
    // fallback: detect token in filename
    if (/s\d{1,2}e\d{1,3}/i.test(filename))
        return 0.8;
    return 0.25;
}
// Zod schemas
const MediaItemSchema = zod_1.z.object({
    mediaId: zod_1.z.string().min(1).optional(),
    title: zod_1.z.string().min(1),
    filename: zod_1.z.string().min(1),
    path: zod_1.z.string().min(1),
    type: zod_1.z.enum(['movie', 'episode']),
    season: zod_1.z.number().int().nonnegative().optional(),
    episode: zod_1.z.number().int().nonnegative().optional(),
    year: zod_1.z.number().int().optional(),
    size: zod_1.z.number().positive(),
    duration: zod_1.z.number().positive(),
    codec: zod_1.z.string().optional(),
    posterUrl: zod_1.z.string().url().optional(),
    backdropUrl: zod_1.z.string().url().optional(),
    tmdbId: zod_1.z.number().int().optional(),
    addedAt: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.number()]).optional(),
    // helper fields (server-computed)
    librarySection: zod_1.z.enum(['movies', 'tv']).optional(),
    normalizedTitle: zod_1.z.string().nullable().optional(),
    episodeNumber: zod_1.z.number().int().nullable().optional(),
    matchConfidence: zod_1.z.number().min(0).max(1).nullable().optional(),
    matchMethod: zod_1.z.enum(['title+year', 'show+S/E', 'manual']).nullable().optional(),
    manualOverride: zod_1.z.boolean().optional(),
});
const AgentIngestBodySchema = zod_1.z.object({
    items: zod_1.z.array(MediaItemSchema).max(200)
});
const AgentIngestInputSchema = AgentIngestBodySchema.extend({
    apiKey: zod_1.z.string().min(1),
});
function timingSafeHexEquals(aHex, bHex) {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) {
        crypto.timingSafeEqual(a, Buffer.alloc(a.length));
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}
function scryptHex(key, salt, length = 64) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(key, salt, length, (err, derivedKey) => {
            if (err)
                return reject(err);
            resolve(derivedKey.toString('hex'));
        });
    });
}
function stableMediaId(serverId, path) {
    const h = crypto.createHash('sha256');
    h.update(`${serverId}:${path}`);
    return h.digest('hex');
}
function deriveLibrarySection(path) {
    const segments = path.toLowerCase().split(/[\\/]/);
    if (segments.includes('movies'))
        return 'movies';
    if (segments.includes('tv'))
        return 'tv';
    return undefined;
}
async function agentIngestFlow(rawInput) {
    const parsedInput = AgentIngestInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
        const errorMessages = parsedInput.error.issues.map(issue => issue.message).join(', ');
        const result = { status: 'error', message: `Invalid payload structure: ${errorMessages}` };
        return { results: [result], ownerUid: null, serverId: null };
    }
    const { apiKey, items } = parsedInput.data;
    if (items.length === 0)
        return { results: [], ownerUid: null, serverId: null };
    const serversSnap = await db.collectionGroup('servers').where('status', '==', 'linked').get();
    let matchedRef = null;
    let ownerUid = null;
    let serverId = null;
    for (const docSnap of serversSnap.docs) {
        const data = docSnap.data();
        if (!data.apiKeyHash || !data.salt)
            continue;
        const computedHash = await scryptHex(apiKey, data.salt, 64);
        if (timingSafeHexEquals(computedHash, data.apiKeyHash)) {
            matchedRef = docSnap.ref;
            ownerUid = docSnap.ref.parent.parent?.id ?? null;
            serverId = data.serverId || docSnap.ref.id;
            break;
        }
    }
    if (!matchedRef || !ownerUid || !serverId) {
        const err = new Error('Invalid or unauthorized API key provided.');
        err.code = 'permission-denied';
        throw err;
    }
    matchedRef.update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() }).catch(() => { });
    const BATCH_SIZE = 450;
    const results = [];
    let batch = db.batch();
    let opsInBatch = 0;
    for (const item of items) {
        try {
            MediaItemSchema.parse(item);
            const mid = item.mediaId || stableMediaId(serverId, item.path);
            const docRef = db.doc(`users/${ownerUid}/media/${mid}`);
            const existingDoc = await docRef.get().then(s => s.exists ? s.data() : null);
            const dataToUpsert = {
                ...item,
                mediaId: mid,
                serverId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
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
                    const parsed = (0, episodeParser_1.parseEpisodeFromName)(item.filename);
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
            }
            else {
                // movie
                if (recomputeHelpers || existingDoc.normalizedTitle === undefined) {
                    dataToUpsert.normalizedTitle = (0, normalizeTitle_1.normalizeTitle)({ filename: item.filename, path: item.path, type: 'movie', year: item.year ?? null });
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
            if (existingDoc?.manualOverride === undefined)
                dataToUpsert.manualOverride = false;
            if (existingDoc?.matchConfidence === undefined && dataToUpsert.matchConfidence === undefined)
                dataToUpsert.matchConfidence = null;
            if (existingDoc?.matchMethod === undefined && dataToUpsert.matchMethod === undefined)
                dataToUpsert.matchMethod = null;
            batch.set(docRef, dataToUpsert, { merge: true });
            opsInBatch++;
            results.push({ mediaId: mid, status: 'upserted', path: item.path });
            if (opsInBatch >= BATCH_SIZE) {
                await batch.commit();
                batch = db.batch();
                opsInBatch = 0;
            }
        }
        catch (e) {
            results.push({ status: 'error', message: e?.message || 'Unknown processing error', path: item?.path });
        }
    }
    if (opsInBatch > 0)
        await batch.commit();
    return { results, ownerUid, serverId };
}
