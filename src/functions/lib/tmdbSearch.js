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
const functions = __importStar(require("firebase-functions"));
const cors_1 = __importDefault(require("cors"));
const tmdbClient_1 = require("./tmdbClient");
const corsHandler = (0, cors_1.default)({ origin: true });
function getYear(dateString) {
    if (!dateString)
        return null;
    const year = parseInt(dateString.substring(0, 4), 10);
    return isNaN(year) ? null : year;
}
exports.default = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        try {
            const { q, kind, year, page = 1 } = req.body;
            if (!q || typeof q !== 'string') {
                res.status(400).json({ error: 'Missing or invalid query parameter "q".' });
                return;
            }
            if (kind !== 'movie' && kind !== 'tv') {
                res.status(400).json({ error: 'Invalid "kind" parameter. Must be "movie" or "tv".' });
                return;
            }
            let tmdbResults;
            if (kind === 'movie') {
                tmdbResults = await (0, tmdbClient_1.searchMovie)(q, year, page);
            }
            else {
                tmdbResults = await (0, tmdbClient_1.searchTV)(q, year, page);
            }
            if (!tmdbResults || !Array.isArray(tmdbResults.results)) {
                res.status(500).json({ error: 'Failed to fetch from TMDB or malformed response.' });
                return;
            }
            const results = tmdbResults.results.slice(0, 10).map((item) => {
                if (kind === 'movie') {
                    return {
                        id: item.id,
                        title: item.title,
                        year: getYear(item.release_date),
                        posterUrl: (0, tmdbClient_1.posterUrl)(item.poster_path, 'w185'),
                    };
                }
                else { // kind === 'tv'
                    return {
                        id: item.id,
                        title: item.name,
                        year: getYear(item.first_air_date),
                        posterUrl: (0, tmdbClient_1.posterUrl)(item.poster_path, 'w185'),
                    };
                }
            });
            res.status(200).json(results);
        }
        catch (error) {
            functions.logger.error('Error in tmdbSearch:', error);
            res.status(500).json({ error: 'An internal error occurred.' });
        }
    });
});
//# sourceMappingURL=tmdbSearch.js.map