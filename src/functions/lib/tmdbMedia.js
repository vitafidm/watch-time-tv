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
const node_fetch_1 = __importDefault(require("node-fetch"));
const tmdbClient_1 = require("./tmdbClient"); // keep using your existing helper
const corsHandler = (0, cors_1.default)({ origin: true });
function mapKind(kind) {
    return kind === "show" ? "tv" : kind;
}
exports.default = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method Not Allowed" });
            return;
        }
        try {
            const { kind, tmdbId, language } = req.body || {};
            const k = mapKind(kind);
            const idNum = Number(tmdbId);
            if (!idNum || Number.isNaN(idNum)) {
                functions.logger.error("tmdbMedia: invalid tmdbId", { tmdbId });
                res.status(400).json({ error: "Invalid tmdbId" });
                return;
            }
            if (k !== "movie" && k !== "tv") {
                functions.logger.error("tmdbMedia: invalid kind", { kind });
                res.status(400).json({ error: "Invalid kind. Use 'movie' or 'tv'." });
                return;
            }
            const apiKey = (functions.config()?.tmdb && functions.config().tmdb.key) ||
                process.env.TMDB_API_KEY;
            if (!apiKey) {
                functions.logger.error("tmdbMedia: missing TMDB API key");
                res.status(500).json({ error: "TMDB API key not configured" });
                return;
            }
            // Build TMDB URL (inline base URL; your tmdbClient didn’t export one)
            const url = new URL(`https://api.themoviedb.org/3/${k}/${idNum}`);
            url.searchParams.set("api_key", apiKey);
            url.searchParams.set("append_to_response", "images,videos");
            // Accept original + English + optional requested language
            url.searchParams.set("include_image_language", ["null", "en", language].filter(Boolean).join(","));
            if (language)
                url.searchParams.set("language", language);
            functions.logger.info("tmdbMedia: fetching", {
                url: url.toString(),
                kind: k,
                idNum,
            });
            const resp = await (0, node_fetch_1.default)(url.toString());
            if (!resp.ok) {
                const text = await resp.text().catch(() => "");
                functions.logger.error("tmdbMedia: TMDB fetch failed", {
                    status: resp.status,
                    text: text?.slice(0, 400),
                });
                res.status(502).json({ error: `TMDB responded ${resp.status}` });
                return;
            }
            const data = await resp.json();
            // Normalize posters/backdrops using your posterUrl helper.
            // Sizes allowed by your typing: "w185" | "w500" | "original"
            const posters = Array.isArray(data?.images?.posters)
                ? data.images.posters
                    .filter((p) => p?.file_path)
                    .slice(0, 60)
                    .map((p) => ({ url: (0, tmdbClient_1.posterUrl)(p.file_path, "w500") }))
                : [];
            const backdrops = Array.isArray(data?.images?.backdrops)
                ? data.images.backdrops
                    .filter((b) => b?.file_path)
                    .slice(0, 60)
                    .map((b) => ({ url: (0, tmdbClient_1.posterUrl)(b.file_path, "original") }))
                : [];
            // Normalize videos (YouTube trailers)
            const videos = Array.isArray(data?.videos?.results)
                ? data.videos.results
                    .filter((v) => v?.site === "YouTube" && v?.key)
                    .slice(0, 30)
                    .map((v) => ({
                    key: v.key,
                    name: v.name,
                    type: v.type,
                    thumbnailUrl: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`,
                }))
                : [];
            res.json({ posters, backdrops, videos });
        }
        catch (err) {
            functions.logger.error("tmdbMedia: internal error", {
                message: err?.message,
                stack: err?.stack,
            });
            res.status(500).json({ error: "Internal error in tmdbMedia" });
        }
    });
});
