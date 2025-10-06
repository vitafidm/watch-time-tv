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
exports.tmdbFetch = tmdbFetch;
exports.searchMovie = searchMovie;
exports.searchTV = searchTV;
exports.movieDetails = movieDetails;
exports.tvDetails = tvDetails;
exports.posterUrl = posterUrl;
exports.backdropUrl = backdropUrl;
// functions/src/tmdbClient.ts
const functions = __importStar(require("firebase-functions"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE_URL = "https://image.tmdb.org/t/p/";
// Small helper to pause
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getApiKey() {
    // Prefer Functions config (production), fall back to env (local/emulator)
    try {
        const fromConfig = functions.config()?.tmdb?.key;
        if (fromConfig)
            return fromConfig;
    }
    catch {
        // accessing functions.config() can throw in some local contexts — ignore
    }
    const fromEnv = process.env.TMDB_API_KEY;
    if (fromEnv)
        return fromEnv;
    throw new Error("TMDB API key not found. Set with `firebase functions:config:set tmdb.key=\"YOUR_KEY\"` " +
        "or set TMDB_API_KEY in your environment.");
}
/**
 * Core fetcher with lightweight retry/backoff for rate limits and transient failures.
 */
async function tmdbFetch(path, params = {}) {
    const apiKey = getApiKey();
    const url = new URL(`${TMDB_BASE_URL}/${path}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", "en-US");
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null)
            url.searchParams.set(k, String(v));
    }
    // Gentle pacing for normal requests
    await sleep(150);
    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
        attempt++;
        let res = null;
        try {
            res = await (0, node_fetch_1.default)(url.toString(), {
                headers: {
                    "Accept": "application/json",
                    // Helps TMDB support know who you are if needed; optional:
                    "User-Agent": "watchtime-functions/1.0",
                },
            });
            // Successful
            if (res.ok) {
                return await res.json();
            }
            // Retry on 429 / 5xx
            const status = res.status;
            const text = await res.text().catch(() => "");
            const retryAfter = Number(res.headers.get("retry-after")) || 0;
            if (status === 429 || (status >= 500 && status < 600)) {
                const backoff = retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(2000 * attempt, 6000); // simple backoff cap at 6s
                functions.logger.warn("TMDB transient error; backing off", {
                    status,
                    attempt,
                    backoffMs: backoff,
                    url: url.toString(),
                    body: text?.slice(0, 500),
                });
                await sleep(backoff);
                continue;
            }
            // Non-retryable error
            functions.logger.error("TMDB API error (non-retryable)", {
                status,
                url: url.toString(),
                body: text?.slice(0, 1000),
            });
            return null;
        }
        catch (err) {
            // Network/parsing error; retry a couple times
            functions.logger.warn("TMDB fetch threw; retrying if attempts remain", {
                attempt,
                error: err?.message,
                url: url.toString(),
            });
            await sleep(Math.min(2000 * attempt, 6000));
            continue;
        }
    }
    // Exhausted attempts
    functions.logger.error("TMDB fetch failed after retries", { url: url.toString() });
    return null;
}
// ---- Convenience wrappers ----
async function searchMovie(title, year, page = 1) {
    const params = {
        query: title,
        include_adult: "false",
        page: String(page),
    };
    if (year)
        params.year = String(year);
    return tmdbFetch("search/movie", params);
}
async function searchTV(title, year, page = 1) {
    const params = {
        query: title,
        include_adult: "false",
        page: String(page),
    };
    if (year)
        params.first_air_date_year = String(year);
    return tmdbFetch("search/tv", params);
}
async function movieDetails(id) {
    // includes videos/credits/images for richer Fix Match writes
    return tmdbFetch(`movie/${id}`, { append_to_response: "videos,credits,images" });
}
async function tvDetails(id) {
    // includes aggregate_credits/videos/images to align with Fix Match & enrichment parity
    return tmdbFetch(`tv/${id}`, { append_to_response: "videos,aggregate_credits,images" });
}
// ---- Image helpers ----
function posterUrl(path, size = "w500") {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}
function backdropUrl(path, size = "w780") {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}
