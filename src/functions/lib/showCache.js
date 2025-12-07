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
exports.getShowFromCache = getShowFromCache;
exports.getShowFromCacheOrTMDB = getShowFromCacheOrTMDB;
// functions/src/showCache.ts (or ./showCache.ts wherever it lives)
const admin = __importStar(require("firebase-admin"));
const initFirebase_1 = require("./initFirebase");
const tmdbClient_1 = require("./tmdbClient");
async function getShowFromCache(tmdbShowId) {
    const ref = initFirebase_1.db.doc(`shows/${tmdbShowId}`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    // ensure id is present
    return { ...data, tmdbShowId, updatedAt: data.updatedAt };
}
// Helper to pick the best logo from TMDB details (if images are present)
function pickBestLogoFromDetails(details) {
    const logos = details?.images?.logos;
    if (!Array.isArray(logos) || logos.length === 0)
        return null;
    // Sort by vote_count as a crude quality proxy
    const sorted = [...logos].sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
    const preferredLangs = [
        details?.original_language ?? null,
        "en",
    ];
    for (const lang of preferredLangs) {
        if (!lang)
            continue;
        const hit = sorted.find((l) => l.iso_639_1 === lang && l.file_path);
        if (hit?.file_path) {
            // Reuse backdropUrl helper to build a full TMDB image URL
            return (0, tmdbClient_1.backdropUrl)(hit.file_path, "original");
        }
    }
    const first = sorted.find((l) => l.file_path);
    return first?.file_path ? (0, tmdbClient_1.backdropUrl)(first.file_path, "original") : null;
}
// Normalize TMDB videos into ExtraVideo[]
function normalizeVideoKind(rawType) {
    const t = (rawType || "").toLowerCase();
    if (t === "trailer")
        return "trailer";
    if (t === "teaser")
        return "teaser";
    if (t === "clip")
        return "clip";
    if (t === "behind the scenes" || t === "behind-the-scenes")
        return "behind_the_scenes";
    if (t === "featurette")
        return "featurette";
    if (t === "bloopers")
        return "bloopers";
    if (t === "opening credits")
        return "opening_credits";
    return "other";
}
function buildVideoUrl(site, key) {
    if (!site || !key)
        return null;
    if (site === "YouTube")
        return `https://www.youtube.com/watch?v=${key}`;
    if (site === "Vimeo")
        return `https://vimeo.com/${key}`;
    return null;
}
function extractExtraVideos(details) {
    const raw = details?.videos?.results;
    if (!Array.isArray(raw) || raw.length === 0)
        return [];
    return raw.map((v) => {
        const id = String(v.id ?? "");
        const site = v.site ?? null;
        const key = v.key ?? null;
        const type = v.type ?? null;
        const name = v.name ?? null;
        const official = typeof v.official === "boolean" ? v.official : null;
        const language = v.iso_639_1 ?? null;
        const region = v.iso_3166_1 ?? null;
        const publishedAt = v.published_at ?? null;
        return {
            id,
            site,
            key,
            url: buildVideoUrl(site, key),
            type,
            kind: normalizeVideoKind(type),
            name,
            official,
            language,
            region,
            publishedAt,
        };
    });
}
async function getShowFromCacheOrTMDB(tmdbShowId) {
    const cached = await getShowFromCache(tmdbShowId);
    if (cached) {
        return cached;
    }
    // IMPORTANT: tvDetails should be implemented to call TMDB /tv/{id}
    // with append_to_response including at least "images" (for logos) and "videos" (for extras).
    const details = await (0, tmdbClient_1.tvDetails)(tmdbShowId);
    if (!details) {
        return null;
    }
    const logoUrl = pickBestLogoFromDetails(details); // logo from images
    const extraVideos = extractExtraVideos(details); // extras from videos
    const showData = {
        tmdbShowId: details.id,
        title: details.name,
        overview: details.overview,
        genres: (details.genres || []).map((g) => g.name),
        posterUrl: (0, tmdbClient_1.posterUrl)(details.poster_path, "w500"),
        backdropUrl: (0, tmdbClient_1.backdropUrl)(details.backdrop_path, "original"),
        logoUrl, // cache the logo
        firstAirDate: details.first_air_date,
        extraVideos: extraVideos.length ? extraVideos : null, // cache extra videos if any
    };
    const newDoc = {
        ...showData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await initFirebase_1.db.doc(`shows/${tmdbShowId}`).set(newDoc);
    return newDoc;
}
