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
const corsHandler = (0, cors_1.default)({ origin: true });
exports.default = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        // --- CORS preflight
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.status(204).send('');
            return;
        }
        if (req.method !== 'POST') {
            res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.status(405).json({ error: 'Method Not Allowed' });
            return;
        }
        try {
            res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
            const { kind, tmdbId } = req.body;
            if ((kind !== 'movie' && kind !== 'tv') || !tmdbId) {
                res.status(400).json({ error: 'Invalid parameters' });
                return;
            }
            const apiKey = functions.config().tmdb.key;
            const url = `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${apiKey}&append_to_response=images,videos`;
            const tmdbRes = await (0, node_fetch_1.default)(url);
            if (!tmdbRes.ok) {
                throw new Error(`TMDB fetch failed: ${tmdbRes.statusText}`);
            }
            const data = await tmdbRes.json();
            const posters = (data.images?.posters || []).map((p) => ({
                url: `https://image.tmdb.org/t/p/w500${p.file_path}`,
                width: p.width,
                height: p.height,
                lang: p.iso_639_1,
            }));
            const backdrops = (data.images?.backdrops || []).map((b) => ({
                url: `https://image.tmdb.org/t/p/w780${b.file_path}`,
                width: b.width,
                height: b.height,
                lang: b.iso_639_1,
            }));
            const videos = (data.videos?.results || [])
                .filter((v) => v.site === 'YouTube')
                .map((v) => ({
                key: v.key,
                site: v.site,
                type: v.type,
                name: v.name,
                thumbnailUrl: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`,
            }));
            res.status(200).json({ posters, backdrops, videos });
        }
        catch (error) {
            functions.logger.error('Error in tmdbMedia:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});
//# sourceMappingURL=tmdbMedia.js.map