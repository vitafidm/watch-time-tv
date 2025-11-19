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
exports.tmdbEpisodeDetailsBatch = void 0;
// functions/src/tmdbEpisodeDetailsBatch.ts
const functions = __importStar(require("firebase-functions"));
const tmdbClient_1 = require("./tmdbClient");
function episodeKey(season, episode) {
    return `S${season}E${episode}`;
}
/**
 * HTTP function to batch-fetch TMDB episode details for a given TV show.
 *
 * Request body (flexible, supports both shapes):
 *
 *  {
 *    tmdbShowId: number | string,   // preferred
 *    // or: showId / tvId
 *    episodes?: [
 *      { season: number | string, episode: number | string },
 *      ...
 *    ],
 *    // OR (legacy shape):
 *    items?: [
 *      { season: number | string, episode: number | string, showId?: number | string },
 *      ...
 *    ]
 *  }
 *
 * Response:
 *  {
 *    "S1E1": { name, overview, stillUrl, airDate, runtime },
 *    "S1E2": { ... },
 *    ...
 *  }
 *
 * On any validation/parsing issue, it returns `{}` with status 200
 * so the UI never sees a 400 / Bad Request.
 */
exports.tmdbEpisodeDetailsBatch = functions.https.onRequest(async (req, res) => {
    // --- Manual CORS, no external middleware ---
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    // Preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        if (req.method !== "POST") {
            // Be gentle: don't 400/405, just return empty payload
            functions.logger.info("tmdbEpisodeDetailsBatch: non-POST method", {
                method: req.method,
            });
            res.status(200).json({});
            return;
        }
        const rawBody = (req.body ?? {});
        functions.logger.info("tmdbEpisodeDetailsBatch: incoming body", {
            method: req.method,
            hasBody: !!req.body,
            keys: Object.keys(rawBody || {}),
        });
        // --- Normalize TV show id ---
        const tvIdRaw = rawBody.tmdbShowId ??
            rawBody.showId ??
            rawBody.tvId;
        const tvId = Number(tvIdRaw);
        if (!Number.isFinite(tvId) || tvId <= 0) {
            functions.logger.warn("tmdbEpisodeDetailsBatch: invalid or missing tv/tmdbShowId", {
                tmdbShowId: rawBody.tmdbShowId,
                showId: rawBody.showId,
                tvId: rawBody.tvId,
            });
            res.status(200).json({});
            return;
        }
        // --- Normalize episodes array (support both `episodes` and `items`) ---
        let episodesRaw = [];
        if (Array.isArray(rawBody.episodes)) {
            episodesRaw = rawBody.episodes;
        }
        else if (Array.isArray(rawBody.items)) {
            episodesRaw = rawBody.items;
        }
        const normalized = episodesRaw
            .map((e) => ({
            season: Number(e.season ??
                e.seasonNumber ??
                e.s),
            episode: Number(e.episode ??
                e.episodeNumber ??
                e.e),
        }))
            .filter((e) => Number.isFinite(e.season) &&
            Number.isFinite(e.episode) &&
            e.season > 0 &&
            e.episode > 0);
        if (normalized.length === 0) {
            functions.logger.info("tmdbEpisodeDetailsBatch: no valid episodes in request", {
                episodesLength: Array.isArray(rawBody.episodes)
                    ? rawBody.episodes.length
                    : 0,
                itemsLength: Array.isArray(rawBody.items)
                    ? rawBody.items.length
                    : 0,
            });
            res.status(200).json({});
            return;
        }
        // De-dupe (S/E pairs)
        const seen = new Set();
        const uniqueEpisodes = [];
        for (const ep of normalized) {
            const key = episodeKey(ep.season, ep.episode);
            if (!seen.has(key)) {
                seen.add(key);
                uniqueEpisodes.push(ep);
            }
        }
        const result = {};
        // --- Fetch each episode from TMDB in parallel ---
        await Promise.all(uniqueEpisodes.map(async (ep) => {
            try {
                const path = `tv/${tvId}/season/${ep.season}/episode/${ep.episode}`;
                const raw = await (0, tmdbClient_1.tmdbFetch)(path, {
                    append_to_response: "images",
                });
                if (!raw)
                    return;
                const name = raw.name?.trim() ||
                    (raw.episode_number != null
                        ? `Episode ${raw.episode_number}`
                        : null);
                const overview = raw.overview?.trim() || null;
                // Try primary still, then first in images.stills
                const stillPath = raw.still_path ||
                    (raw.images &&
                        Array.isArray(raw.images.stills) &&
                        raw.images.stills[0]?.file_path) ||
                    undefined;
                const stillUrl = stillPath
                    ? (0, tmdbClient_1.backdropUrl)(stillPath, "w780")
                    : null;
                const airDate = raw.air_date?.trim() || null;
                const runtime = typeof raw.runtime === "number" ? raw.runtime : null;
                const key = episodeKey(ep.season, ep.episode);
                result[key] = {
                    name,
                    overview,
                    stillUrl,
                    airDate,
                    runtime,
                };
            }
            catch (err) {
                functions.logger.warn("tmdbEpisodeDetailsBatch: episode fetch failed", {
                    tvId,
                    season: ep.season,
                    episode: ep.episode,
                    error: err?.message,
                });
            }
        }));
        res.status(200).json(result);
    }
    catch (err) {
        functions.logger.error("tmdbEpisodeDetailsBatch: unexpected error", { error: err?.message });
        // Fail soft so the UI never gets a 400
        res.status(200).json({});
    }
});
