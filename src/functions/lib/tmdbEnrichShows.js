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
const IMG_BASE = "https://image.tmdb.org/t/p";
function fullImg(path, size = "original") {
    return path ? `${IMG_BASE}/${size}${path}` : null;
}
// Trailer picker (prefers official YouTube trailer)
function pickYouTubeTrailer(results) {
    if (!Array.isArray(results))
        return null;
    const best = results.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
        results.find((v) => v.site === "YouTube" && v.type === "Trailer") ||
        results.find((v) => v.site === "YouTube");
    return best?.key ? `https://www.youtube.com/watch?v=${best.key}` : null;
}
// TMDB search
async function tmdbSearchShow(apiKey, title) {
    const url = new URL(`${TMDB_BASE}/search/tv`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", title);
    url.searchParams.set("include_adult", "false");
    const r = await (0, node_fetch_1.default)(url.toString());
    if (!r.ok)
        return null;
    const j = (await r.json());
    return (j?.results || [])[0] || null;
}
// TMDB details with rich data (now also includes images for logos)
async function tmdbShowDetails(apiKey, id) {
    const url = new URL(`${TMDB_BASE}/tv/${id}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("append_to_response", "aggregate_credits,videos,images");
    const r = await (0, node_fetch_1.default)(url.toString());
    if (!r.ok)
        return null;
    return (await r.json());
}
function pickBestLogo(logos, preferredLangs = ["en"]) {
    if (!Array.isArray(logos) || logos.length === 0)
        return null;
    // Sort logos by vote_count desc (as a rough quality proxy)
    const sorted = [...logos].sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
    // Try preferred languages first
    for (const lang of preferredLangs) {
        const hit = sorted.find((l) => l.iso_639_1 === lang && l.file_path);
        if (hit?.file_path) {
            return fullImg(hit.file_path, "original");
        }
    }
    // Fallback: first logo with a file_path
    const first = sorted.find((l) => !!l.file_path);
    return first?.file_path ? fullImg(first.file_path, "original") : null;
}
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
const handler = async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res.status(405).json({ error: "Method Not Allowed" });
            }
            // --- Auth ---
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith("Bearer ")) {
                throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
            }
            const idToken = authHeader.slice("Bearer ".length);
            const decoded = await admin.auth().verifyIdToken(idToken);
            const uid = decoded.uid;
            if (!uid)
                throw new functions.https.HttpsError("unauthenticated", "Invalid ID token.");
            const { batchSize = 25, startAfterId } = (req.body || {});
            functions.logger.info("tmdbEnrichShows called", {
                uid,
                batchSize,
                startAfterId,
            });
            const apiKey = process.env.TMDB_API_KEY;
            if (!apiKey)
                throw new functions.https.HttpsError("failed-precondition", "TMDB_API_KEY not set");
            // --- Query: only shows that still need enrichment ---
            // Rely on materializer to set tmdbShowId = null on new/legacy docs.
            let q = db
                .collection(`users/${uid}/shows`)
                .where("tmdbShowId", "==", null)
                .orderBy(admin.firestore.FieldPath.documentId());
            if (startAfterId)
                q = q.startAfter(startAfterId);
            const snap = await q
                .limit(Math.max(1, Math.min(100, Number(batchSize) || 25)))
                .get();
            if (snap.empty)
                return res.json({
                    processed: 0,
                    enriched: 0,
                    skipped: 0,
                    notFound: 0,
                });
            let processed = 0;
            let enriched = 0;
            let skipped = 0;
            let notFound = 0;
            for (const doc of snap.docs) {
                processed++;
                const data = doc.data() || {};
                // Honor negative cache
                if (data.matchStatus === "not_found") {
                    skipped++;
                    continue;
                }
                // Compose best input title
                const title = (typeof data.title === "string" && data.title.trim()) ||
                    (typeof data.titleCandidate === "string" &&
                        data.titleCandidate.trim()) ||
                    (typeof data.normalizedTitle === "string" &&
                        data.normalizedTitle.trim()) ||
                    null;
                if (!title) {
                    await doc.ref.set({
                        matchStatus: "not_found",
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    notFound++;
                    continue;
                }
                try {
                    const hit = await tmdbSearchShow(apiKey, title);
                    if (!hit) {
                        await doc.ref.set({
                            matchStatus: "not_found",
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                        notFound++;
                        continue;
                    }
                    const details = await tmdbShowDetails(apiKey, hit.id);
                    if (!details) {
                        await doc.ref.set({
                            matchStatus: "not_found",
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                        notFound++;
                        continue;
                    }
                    // Respect locks: don't overwrite poster/backdrop/logo if locked
                    const posterLocked = !!data.posterLocked;
                    const backdropLocked = !!data.backdropLocked;
                    const logoLocked = !!data.logoLocked;
                    // Compute logo URL from TMDB images
                    const logoUrlFromTmdb = pickBestLogo(details.images?.logos, [
                        details.original_language || "en",
                        "en",
                    ]);
                    // Compute extra videos from TMDB
                    const extraVideosFromTmdb = extractExtraVideos(details);
                    const extraVideosValue = data.extraVideos ??
                        (extraVideosFromTmdb.length ? extraVideosFromTmdb : null);
                    // Choose final logoUrl respecting existing value
                    const logoUrlValue = logoUrlFromTmdb ?? (data.logoUrl ?? null);
                    const update = {
                        // Write BOTH ids for compatibility
                        tmdbId: details.id,
                        tmdbShowId: details.id,
                        tmdbType: "tv",
                        title: details.name || title,
                        normalizedTitle: details.name || title,
                        overview: details.overview || null,
                        genres: (details.genres || [])
                            .map((g) => g?.name)
                            .filter(Boolean),
                        firstAirDate: details.first_air_date || null,
                        voteAverage: details.vote_average ?? null,
                        language: details.original_language ?? null,
                        // Images (respect locks)
                        ...(posterLocked
                            ? {}
                            : { posterUrl: fullImg(details.poster_path, "w500") }),
                        ...(backdropLocked
                            ? {}
                            : { backdropUrl: fullImg(details.backdrop_path, "original") }),
                        ...(logoLocked ? {} : { logoUrl: logoUrlValue }),
                        // Extra videos (no lock; but do not clobber an existing non-null value)
                        extraVideos: extraVideosValue,
                        // Rich fields
                        cast: (details.aggregate_credits?.cast || [])
                            .slice(0, 10)
                            .map((c) => ({
                            name: c?.name || "",
                            character: (Array.isArray(c?.roles)
                                ? c.roles
                                    .map((r) => r?.character)
                                    .filter(Boolean)
                                    .join(", ")
                                : c?.character) || "",
                            profileUrl: fullImg(c?.profile_path, "w185"),
                        })),
                        videoLink: pickYouTubeTrailer(details.videos?.results) || null,
                        matchStatus: "matched",
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    };
                    await doc.ref.set(update, { merge: true });
                    enriched++;
                }
                catch (err) {
                    functions.logger.error("tmdbEnrichShows inner error", {
                        showId: doc.id,
                        error: err,
                    });
                    await doc.ref.set({
                        matchStatus: "error",
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    notFound++;
                }
            }
            const lastDoc = snap.docs[snap.docs.length - 1];
            const nextStartAfterId = lastDoc?.id || null;
            return res.json({
                processed,
                enriched,
                skipped,
                notFound,
                nextStartAfterId,
            });
        }
        catch (err) {
            functions.logger.error("tmdbEnrichShows fatal", { error: err });
            const code = err?.code || "internal";
            const message = err?.message || "An internal error occurred.";
            const status = code === "unauthenticated"
                ? 403
                : code === "invalid-argument"
                    ? 400
                    : 500;
            return res.status(status).json({ error: { code, message } });
        }
    });
};
exports.default = functions
    .runWith({ timeoutSeconds: 300, memory: "512MB" })
    .https.onRequest(handler);
