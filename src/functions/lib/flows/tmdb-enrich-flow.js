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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tmdbEnrichFlow = tmdbEnrichFlow;
exports.tmdbBackfillSweep = tmdbBackfillSweep;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const zod_1 = require("zod");
const db = admin.firestore();
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";
const EnrichBodySchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        mediaId: zod_1.z.string().min(1),
        type: zod_1.z.enum(["movie", "episode"]),
        title: zod_1.z.string().min(1),
        year: zod_1.z.number().int().optional()
    })).min(1).max(50)
});
function cacheKey(type, title, year) {
    const base = `${type === "episode" ? "tv" : "movie"}:${title.trim().toLowerCase()}:${year ?? ""}`;
    return crypto.createHash("sha1").update(base).digest("hex").slice(0, 40);
}
function pickBestImage(path) {
    if (!path)
        return null;
    return `${IMG_BASE}${path}`;
}
async function tmdbSearch(apiKey, type, title, year) {
    const isTV = type === "episode";
    const endpoint = isTV ? "search/tv" : "search/movie";
    const url = new URL(`${TMDB_BASE}/${endpoint}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", title);
    if (year)
        url.searchParams.set(isTV ? "first_air_date_year" : "year", String(year));
    url.searchParams.set("include_adult", "false");
    const r = await (0, node_fetch_1.default)(url.toString(), { method: "GET" });
    if (!r.ok)
        return null;
    const j = await r.json();
    const first = (j?.results || [])[0];
    if (!first)
        return null;
    return { id: first.id, tmdbType: isTV ? "tv" : "movie" };
}
async function tmdbDetails(apiKey, tmdbType, id) {
    const url = new URL(`${TMDB_BASE}/${tmdbType}/${id}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("append_to_response", "credits");
    const r = await (0, node_fetch_1.default)(url.toString(), { method: "GET" });
    if (!r.ok)
        return null;
    return r.json();
}
async function tmdbEnrichFlow(uid, rawBody) {
    const parsed = EnrichBodySchema.safeParse(rawBody);
    if (!parsed.success) {
        const e = new Error(JSON.stringify(parsed.error.issues));
        e.code = "invalid-argument";
        throw e;
    }
    if (!process.env.TMDB_API_KEY) {
        const e = new Error("TMDB_API_KEY not set");
        e.code = "failed-precondition";
        throw e;
    }
    const apiKey = process.env.TMDB_API_KEY;
    const { items } = parsed.data;
    // simple per-user rate limit: 1 call / 10s
    const rateRef = db.doc(`users/${uid}/integrations_meta/tmdbRateLimit`);
    const rateSnap = await rateRef.get();
    const now = Date.now();
    const cooldownMs = 10000;
    if (rateSnap.exists) {
        const until = rateSnap.get("rateLimitedUntil")?.toDate?.();
        if (until && until.getTime() > now) {
            const e = new Error("Please wait before enriching again.");
            e.code = "resource-exhausted";
            throw e;
        }
    }
    await rateRef.set({
        lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
        rateLimitedUntil: admin.firestore.Timestamp.fromDate(new Date(now + cooldownMs))
    }, { merge: true });
    const results = [];
    for (const it of items) {
        const mediaRef = db.doc(`users/${uid}/media/${it.mediaId}`);
        const mediaSnap = await mediaRef.get();
        if (!mediaSnap.exists) {
            results.push({ mediaId: it.mediaId, status: "error", message: "media not found" });
            continue;
        }
        const media = mediaSnap.data() || {};
        // Skip if tmdb already present & images exist
        if (media.tmdbId && (media.posterUrl || media.backdropUrl)) {
            results.push({ mediaId: it.mediaId, status: "skipped" });
            continue;
        }
        const key = cacheKey(it.type, it.title, it.year);
        // Fixed: valid collection/doc path
        const cacheRef = db.collection(`users/${uid}/integrations_cache_tmdb`).doc(key);
        let cached = await cacheRef.get().then(s => s.exists ? s.data() : null);
        // 30-day cache TTL
        const fresh = !!cached?.cachedAt &&
            typeof cached.cachedAt?.toDate === "function" &&
            (Date.now() - cached.cachedAt.toDate().getTime() < 30 * 24 * 3600 * 1000);
        try {
            if (!cached || !fresh) {
                const search = await tmdbSearch(apiKey, it.type, it.title, it.year);
                if (!search) {
                    results.push({ mediaId: it.mediaId, status: "not_found" });
                    continue;
                }
                const details = await tmdbDetails(apiKey, search.tmdbType, search.id);
                if (!details) {
                    results.push({ mediaId: it.mediaId, status: "not_found" });
                    continue;
                }
                const genres = (details.genres || []).map((g) => g.name).filter(Boolean);
                const overview = details.overview || null;
                const releaseDate = details.release_date || null;
                const firstAirDate = details.first_air_date || null;
                const voteAverage = typeof details.vote_average === "number" ? details.vote_average : null;
                const language = details.original_language || null;
                const toWrite = {
                    tmdbId: details.id,
                    tmdbType: search.tmdbType, // <- "movie" | "tv"
                    overview,
                    genres,
                    releaseDate,
                    firstAirDate,
                    posterPath: details.poster_path ?? null,
                    backdropPath: details.backdrop_path ?? null,
                    voteAverage,
                    language,
                    cachedAt: admin.firestore.FieldValue.serverTimestamp()
                };
                await cacheRef.set(toWrite, { merge: true });
                cached = toWrite;
            }
            if (!cached) {
                results.push({ mediaId: it.mediaId, status: "error", message: "cache unavailable" });
                continue;
            }
            const payload = {
                tmdbId: cached.tmdbId,
                tmdbType: cached.tmdbType,
                overview: cached.overview ?? media.overview ?? null,
                genres: cached.genres ?? media.genres ?? null,
                releaseDate: cached.releaseDate ?? media.releaseDate ?? null,
                firstAirDate: cached.firstAirDate ?? media.firstAirDate ?? null,
                posterUrl: pickBestImage(cached.posterPath) ?? media.posterUrl ?? null,
                backdropUrl: pickBestImage(cached.backdropPath) ?? media.backdropUrl ?? null,
                voteAverage: cached.voteAverage ?? media.voteAverage ?? null,
                language: cached.language ?? media.language ?? null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await mediaRef.set(payload, { merge: true });
            results.push({ mediaId: it.mediaId, status: "enriched" });
        }
        catch (err) {
            results.push({ mediaId: it.mediaId, status: "error", message: err?.message || "TMDB error" });
        }
    }
    return { results };
}
// Scheduled sweep for missing metadata
async function tmdbBackfillSweep() {
    const snap = await db.collectionGroup("media")
        .where("tmdbId", "==", null)
        .limit(200)
        .get();
    const byOwner = {};
    for (const d of snap.docs) {
        const path = d.ref.path; // users/{uid}/media/{mediaId}
        const segs = path.split("/");
        const uid = segs[1];
        const m = d.data();
        if (!uid || !m)
            continue;
        const type = (m.type === "episode" ? "episode" : "movie");
        const title = m.normalizedTitle || m.title || m.filename || "unknown";
        const year = m.year;
        (byOwner[uid] || (byOwner[uid] = [])).push({ mediaId: d.id, type, title, year });
    }
    for (const [uid, items] of Object.entries(byOwner)) {
        const chunk = items.slice(0, 50);
        try {
            await tmdbEnrichFlow(uid, { items: chunk });
            await new Promise(r => setTimeout(r, 1000));
        }
        catch (e) {
            console.error(`Skipping backfill for user ${uid} due to error: ${e.message}`);
        }
    }
    return { ownersProcessed: Object.keys(byOwner).length };
}
