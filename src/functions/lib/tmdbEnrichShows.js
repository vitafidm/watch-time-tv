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
// functions/tmdbEnrichShows.ts
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const node_fetch_1 = __importDefault(require("node-fetch"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const corsHandler = (0, cors_1.default)({ origin: true });
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";
// pick best TMDB image path -> full URL
function pickBestImage(path) {
    return path ? `${IMG_BASE}${path}` : null;
}
// Search TMDB for TV show by title
async function tmdbSearchShow(apiKey, title) {
    const url = new URL(`${TMDB_BASE}/search/tv`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", title);
    url.searchParams.set("include_adult", "false");
    const r = await (0, node_fetch_1.default)(url.toString());
    if (!r.ok)
        return null;
    const j = await r.json();
    return (j?.results || [])[0] || null;
}
// Fetch TMDB show details
async function tmdbShowDetails(apiKey, id) {
    const url = new URL(`${TMDB_BASE}/tv/${id}`);
    url.searchParams.set("api_key", apiKey);
    const r = await (0, node_fetch_1.default)(url.toString());
    if (!r.ok)
        return null;
    return r.json();
}
/**
 * POST body: { uid: string, batchSize?: number, startAfterId?: string }
 * Returns: { processed:number, enriched:number, skipped:number, notFound:number, nextStartAfterId?:string }
 */
const handler = async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res.status(405).json({ error: "Method Not Allowed" });
            }
            if (!process.env.TMDB_API_KEY) {
                return res.status(500).json({ error: "TMDB_API_KEY not set" });
            }
            const apiKey = process.env.TMDB_API_KEY;
            const { uid, batchSize = 20, startAfterId } = req.body || {};
            if (!uid || typeof uid !== "string") {
                return res.status(400).json({ error: "Missing uid" });
            }
            let q = db.collection(`users/${uid}/shows`).orderBy(admin.firestore.FieldPath.documentId());
            if (startAfterId)
                q = q.startAfter(startAfterId);
            const snap = await q.limit(batchSize).get();
            if (snap.empty) {
                return res.json({ processed: 0, enriched: 0, skipped: 0, notFound: 0 });
            }
            let processed = 0;
            let enriched = 0;
            let skipped = 0;
            let notFound = 0;
            for (const doc of snap.docs) {
                processed++;
                const data = doc.data() || {};
                const { title, tmdbShowId, posterUrl } = data;
                // Skip if already enriched
                if (tmdbShowId && posterUrl) {
                    skipped++;
                    continue;
                }
                if (!title) {
                    notFound++;
                    continue;
                }
                try {
                    const hit = await tmdbSearchShow(apiKey, title);
                    if (!hit) {
                        notFound++;
                        continue;
                    }
                    const details = await tmdbShowDetails(apiKey, hit.id);
                    if (!details) {
                        notFound++;
                        continue;
                    }
                    const update = {
                        tmdbShowId: details.id,
                        title: details.name || title,
                        overview: details.overview || null,
                        genres: (details.genres || []).map((g) => g.name).filter(Boolean),
                        posterUrl: pickBestImage(details.poster_path),
                        backdropUrl: pickBestImage(details.backdrop_path),
                        firstAirDate: details.first_air_date || null,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    };
                    await doc.ref.set(update, { merge: true });
                    enriched++;
                }
                catch (err) {
                    functions.logger.error("tmdbEnrichShows error", {
                        showId: doc.id,
                        error: err?.message || String(err),
                    });
                    notFound++;
                }
            }
            const lastDoc = snap.docs[snap.docs.length - 1];
            const nextStartAfterId = lastDoc?.id;
            return res.json({ processed, enriched, skipped, notFound, nextStartAfterId });
        }
        catch (err) {
            functions.logger.error("tmdbEnrichShows fatal", err);
            return res.status(500).json({ error: err?.message || "Internal error" });
        }
    });
};
exports.default = functions
    .runWith({ timeoutSeconds: 300, memory: "512MB" })
    .https.onRequest(handler);
