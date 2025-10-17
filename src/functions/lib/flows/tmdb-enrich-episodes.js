"use strict";
// functions/src/flows/tmdb-enrich-episodes.ts
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
exports.tmdbEnrichEpisodes = tmdbEnrichEpisodes;
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const zod_1 = require("zod");
const db = admin.firestore();
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";
const EpisodeEnrichBodySchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        mediaId: zod_1.z.string().min(1),
        showId: zod_1.z.number().int().positive(), // tmdbShowId for parent show
        season: zod_1.z.number().int().nonnegative(),
        episode: zod_1.z.number().int().nonnegative(),
    })).min(1).max(50),
});
function pickBestImage(path) {
    if (!path)
        return null;
    return `${IMG_BASE}${path}`;
}
async function tmdbEpisodeDetails(apiKey, showId, season, episode) {
    const url = new URL(`${TMDB_BASE}/tv/${showId}/season/${season}/episode/${episode}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("append_to_response", "credits");
    const r = await (0, node_fetch_1.default)(url.toString(), { method: "GET" });
    if (!r.ok)
        return null;
    return r.json();
}
async function tmdbEnrichEpisodes(uid, rawBody) {
    const parsed = EpisodeEnrichBodySchema.safeParse(rawBody);
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
    const results = [];
    for (const it of items) {
        const mediaRef = db.doc(`users/${uid}/media/${it.mediaId}`);
        const mediaSnap = await mediaRef.get();
        if (!mediaSnap.exists) {
            results.push({ mediaId: it.mediaId, status: "error", message: "episode not found" });
            continue;
        }
        const media = mediaSnap.data() || {};
        try {
            const details = await tmdbEpisodeDetails(apiKey, it.showId, it.season, it.episode);
            if (!details) {
                results.push({ mediaId: it.mediaId, status: "not_found" });
                continue;
            }
            // Coalesce to avoid overwriting any existing non-null values.
            const episodeTitle = media.episodeTitle ?? (details.name || null);
            const episodeDescription = media.episodeDescription ?? (details.overview || null);
            const episodeThumbnail = media.episodeThumbnail ?? (pickBestImage(details.still_path) ?? null);
            // Keep legacy fields for compatibility, but do not clobber if already present.
            const title = media.title ?? (details.name || null);
            const overview = media.overview ?? (details.overview || null);
            const stillUrl = media.stillUrl ?? (pickBestImage(details.still_path) ?? null);
            const payload = {
                // NEW episode-specific fields
                episodeTitle,
                episodeDescription,
                episodeThumbnail,
                // Legacy fields (safe, non-destructive)
                title,
                overview,
                stillUrl,
                // Common metadata
                airDate: media.airDate ?? details.air_date ?? null,
                season: media.season ?? it.season,
                episode: media.episode ?? it.episode, // keep existing 'episode' if you already use it
                episodeNumber: media.episodeNumber ?? it.episode, // also backfill episodeNumber if missing
                tmdbShowId: media.tmdbShowId ?? it.showId,
                tmdbEpisodeId: media.tmdbEpisodeId ?? details.id,
                // Cast (top 10)
                cast: media.cast ?? (Array.isArray(details?.credits?.cast)
                    ? details.credits.cast.slice(0, 10).map((c) => ({
                        name: c.name,
                        character: c.character,
                        profileUrl: pickBestImage(c.profile_path),
                    }))
                    : []),
                // Bookkeeping for maintenance
                episodeFieldsEnriched: true,
                episodeFieldsEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastEnrichError: null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            await mediaRef.set(payload, { merge: true });
            results.push({ mediaId: it.mediaId, status: "enriched" });
        }
        catch (err) {
            // Log error into doc without blowing away prior success state
            await mediaRef.set({
                lastEnrichError: err?.message || "TMDB error",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            results.push({ mediaId: it.mediaId, status: "error", message: err?.message || "TMDB error" });
        }
    }
    return { results };
}
