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
const functions = __importStar(require("firebase-functions"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/';
// Helper to pause execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function getApiKey() {
    try {
        // This is the primary, recommended way for production.
        const key = functions.config().tmdb.key;
        if (key)
            return key;
    }
    catch (e) {
        // This is a fallback for local testing if functions.config() is not populated.
        // `firebase functions:config:get` does not populate process.env automatically.
        if (process.env.TMDB_API_KEY) {
            return process.env.TMDB_API_KEY;
        }
    }
    throw new Error('TMDB API key not found. Set it with `firebase functions:config:set tmdb.key="YOUR_KEY"` or as TMDB_API_KEY in your local environment.');
}
async function tmdbFetch(path, params) {
    const apiKey = getApiKey();
    const url = new URL(`${TMDB_BASE_URL}/${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('language', 'en-US');
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    await sleep(150); // Be gentle with the API
    const response = await (0, node_fetch_1.default)(url.toString());
    if (!response.ok) {
        console.error(`TMDB API Error: ${response.status} for URL: ${url.toString()}`);
        const errorBody = await response.text();
        console.error('Error Body:', errorBody);
        return null;
    }
    return response.json();
}
async function searchMovie(title, year, page = 1) {
    const params = { query: title, include_adult: 'false', page: String(page) };
    if (year) {
        params.year = String(year);
    }
    return tmdbFetch('search/movie', params);
}
async function searchTV(title, year, page = 1) {
    const params = { query: title, include_adult: 'false', page: String(page) };
    if (year) {
        params.first_air_date_year = String(year);
    }
    return tmdbFetch('search/tv', params);
}
async function movieDetails(id) {
    return tmdbFetch(`movie/${id}`, { append_to_response: 'videos,credits,images' });
}
async function tvDetails(id) {
    return tmdbFetch(`tv/${id}`, { append_to_response: 'videos,aggregate_credits,images' });
}
function posterUrl(path, size = 'w500') {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}
function backdropUrl(path, size = 'w780') {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}
//# sourceMappingURL=tmdbClient.js.map