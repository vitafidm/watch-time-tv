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
// functions/tmdbFixMatch.ts
const functions = __importStar(require("firebase-functions"));
const cors_1 = __importDefault(require("cors"));
const admin = __importStar(require("firebase-admin"));
const crypto_1 = __importDefault(require("crypto"));
const initFirebase_1 = require("./initFirebase");
const titleHelpers_1 = require("./titleHelpers");
const tmdbClient_1 = require("./tmdbClient");
const corsHandler = (0, cors_1.default)({ origin: true });
function normalizeExtraVideos(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return null;
    const mapped = raw
        .map((v) => {
        const key = typeof v?.key === "string" ? v.key : "";
        const site = typeof v?.site === "string" ? v.site : "";
        if (!key || !site)
            return null;
        return {
            id: String(v.id ?? `${site}:${key}`),
            key,
            name: typeof v?.name === "string" ? v.name : null,
            site,
            type: typeof v?.type === "string" ? v.type : null,
            official: Boolean(v?.official),
            size: typeof v?.size === "number" ? v.size : null,
        };
    })
        .filter(Boolean);
    return mapped.length ? mapped : null;
}
function pickBestLogoFromDetails(details) {
    const logos = details?.images?.logos;
    if (!Array.isArray(logos) || logos.length === 0)
        return null;
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
            return (0, tmdbClient_1.backdropUrl)(hit.file_path, "original");
        }
    }
    const first = sorted.find((l) => l.file_path);
    return first?.file_path ? (0, tmdbClient_1.backdropUrl)(first.file_path, "original") : null;
}
/** ---------- Helpers to resolve canonical show doc ---------- **/
function normalizeTitle(raw) {
    return (raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function showIdFromFolder(folderName) {
    const norm = normalizeTitle(folderName);
    return crypto_1.default.createHash("sha1").update(norm).digest("hex").slice(0, 40);
}
/**
 * Given a full file path, return the *show-level* folder info:
 * - showFolderName: the folder name that represents the show
 * - showFolderPath: the full path up to that folder (not including the file), e.g. /.../TV/Animaniacs
 *
 * Handles both:
 *   /TV/Animaniacs/Animaniacs.S04E06.mp4
 *   /TV/Animaniacs/Season 1/Animaniacs.S01E01.mp4
 *   /TV/Bridgerton/S02/Bridgerton.S02E01.mkv
 */
function extractShowFolder(path) {
    if (!path || typeof path !== "string")
        return null;
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2)
        return null;
    const parent = parts[parts.length - 2] || "";
    const grandparent = parts.length >= 3 ? parts[parts.length - 3] : "";
    // "Season 1", "S01", "Series 2", etc.
    const seasonRegex = /^(season\s*\d+(\s*\(.*\))?|s\d+|series\s*\d+)$/i;
    let showFolderName = parent;
    let showFolderPathParts = parts.slice(0, -1);
    if (seasonRegex.test(parent) && grandparent) {
        showFolderName = grandparent;
        showFolderPathParts = parts.slice(0, -2);
    }
    const showFolderPath = "/" + showFolderPathParts.join("/");
    return { showFolderName, showFolderPath };
}
/** ---------- Merge helper respects user locks & preserves existing fields ---------- **/
function mergeShowWithLocks(existing, incoming) {
    // Start with existing so fs-derived fields (folderPath, serverId, episodeCount, etc.) persist
    const merged = {
        ...existing,
        ...incoming,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (existing?.posterLocked)
        merged.posterUrl = existing.posterUrl;
    if (existing?.backdropLocked)
        merged.backdropUrl = existing.backdropUrl;
    if (existing?.videoLocked)
        merged.videoLink = existing.videoLink;
    if (existing?.logoLocked)
        merged.logoUrl = existing.logoUrl;
    return merged;
}
/** ---------- MOVIE FIX ---------- **/
async function handleMovieFix(docRef, tmdbId, includeCast) {
    const snap = await docRef.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "Document not found.");
    }
    const existing = snap.data() || {};
    const details = await (0, tmdbClient_1.movieDetails)(tmdbId);
    if (!details) {
        throw new functions.https.HttpsError("not-found", `Could not fetch movie details for TMDB ID ${tmdbId}.`);
    }
    const extraVideos = normalizeExtraVideos(details.videos?.results) ??
        (existing.extraVideos ?? null);
    const logoUrlFromTmdb = pickBestLogoFromDetails(details) ?? existing.logoUrl ?? null;
    const incoming = {
        tmdbId: details.id,
        tmdbType: "movie",
        title: details.title,
        normalizedTitle: details.title,
        overview: details.overview ?? null,
        releaseDate: details.release_date ?? null,
        genres: (details.genres || []).map((g) => g?.name).filter(Boolean),
        director: details.credits?.crew?.find((c) => c?.job === "Director")?.name || null,
        voteAverage: details.vote_average ?? null,
        language: details.original_language ?? null,
        posterUrl: (0, tmdbClient_1.posterUrl)(details.poster_path, "w500"),
        backdropUrl: (0, tmdbClient_1.backdropUrl)(details.backdrop_path, "original"),
        videoLink: (0, titleHelpers_1.pickYouTubeTrailer)(details.videos?.results),
        logoUrl: logoUrlFromTmdb,
        extraVideos,
    };
    if (includeCast) {
        incoming.cast = (details.credits?.cast || [])
            .slice(0, 10)
            .map((c) => ({
            name: c?.name || "",
            character: c?.character || "",
            profileUrl: (0, tmdbClient_1.posterUrl)(c?.profile_path, "w185"),
        }));
    }
    const merged = mergeShowWithLocks(existing, incoming);
    await docRef.set(merged, { merge: true });
    return { ok: true, docId: docRef.id, kind: "movie", tmdbId };
}
/** ---------- TV / EPISODE FIX (canonical, path-aware) ---------- **/
async function handleTVEpisodeFix(episodeRef, tmdbShowId, includeCast) {
    const epSnap = await episodeRef.get();
    if (!epSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Episode document not found.");
    }
    const ep = epSnap.data() || {};
    const showDetails = await (0, tmdbClient_1.tvDetails)(tmdbShowId);
    if (!showDetails) {
        throw new functions.https.HttpsError("not-found", `Could not fetch TV show details for TMDB ID ${tmdbShowId}.`);
    }
    // Determine user id from path
    const uid = episodeRef.parent?.parent?.id;
    if (!uid) {
        throw new functions.https.HttpsError("internal", "Could not determine user id from path.");
    }
    // 1) Resolve the *canonical* show doc ref
    // Prefer episode.showRef if it points to users/{uid}/shows/{folderHash}
    const epShowRef = typeof ep.showRef === "string" ? ep.showRef : null;
    let targetShowRef;
    let derivedFrom = "showRef";
    if (epShowRef && epShowRef.startsWith(`users/${uid}/shows/`)) {
        targetShowRef = initFirebase_1.db.doc(epShowRef);
    }
    else {
        // Derive from filesystem path (canonical)
        const epPath = typeof ep.path === "string" ? ep.path : null;
        let showId = null;
        let folderPathForDoc = null;
        if (epPath) {
            const extracted = extractShowFolder(epPath);
            if (extracted) {
                showId = showIdFromFolder(extracted.showFolderName);
                folderPathForDoc = extracted.showFolderPath;
                derivedFrom = "path";
            }
        }
        // Fallback: derive from showTitle if path missing
        if (!showId) {
            const titleCandidate = (typeof ep.showTitle === "string" && ep.showTitle) ||
                null;
            if (titleCandidate) {
                showId = showIdFromFolder(titleCandidate);
                derivedFrom = "showTitle";
            }
        }
        // Last resort (rare): if we cannot derive canonical id at all,
        // still avoid creating /shows/{tmdbId} docs by using a deterministic ID from TMDB title
        if (!showId) {
            const fallbackName = showDetails.name || showDetails.original_name || String(tmdbShowId);
            showId = showIdFromFolder(fallbackName);
            derivedFrom = "tmdbNameFallback";
        }
        targetShowRef = initFirebase_1.db.doc(`users/${uid}/shows/${showId}`);
        // If this is a brand-new doc, seed minimal fs fields so we don’t lose them
        const seed = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (folderPathForDoc)
            seed.folderPath = folderPathForDoc;
        if (typeof ep.serverId === "string")
            seed.serverId = ep.serverId;
        // Ensure tmdbShowId field exists (null or value) for future queries if needed
        if (typeof (await targetShowRef.get()).data()?.tmdbShowId === "undefined") {
            seed.tmdbShowId = null;
        }
        await targetShowRef.set(seed, { merge: true });
    }
    // 2) Merge rich TMDB data into the canonical show doc
    const showSnap = await targetShowRef.get();
    const existingShow = showSnap.exists ? showSnap.data() || {} : {};
    const extraVideos = normalizeExtraVideos(showDetails.videos?.results) ??
        (existingShow.extraVideos ?? null);
    const logoUrlFromTmdb = pickBestLogoFromDetails(showDetails) ?? existingShow.logoUrl ?? null;
    const incomingShow = {
        tmdbShowId: showDetails.id, // store ID as field, not doc id
        tmdbType: "tv",
        title: showDetails.name ?? existingShow.title ?? null,
        normalizedTitle: showDetails.name ?? existingShow.normalizedTitle ?? null,
        overview: showDetails.overview ?? null,
        genres: (showDetails.genres || []).map((g) => g?.name).filter(Boolean),
        firstAirDate: showDetails.first_air_date ?? null,
        voteAverage: showDetails.vote_average ?? null,
        language: showDetails.original_language ?? null,
        posterUrl: (0, tmdbClient_1.posterUrl)(showDetails.poster_path, "w500"),
        backdropUrl: (0, tmdbClient_1.backdropUrl)(showDetails.backdrop_path, "original"),
        logoUrl: logoUrlFromTmdb,
        extraVideos,
    };
    if (includeCast) {
        incomingShow.cast = (showDetails.aggregate_credits?.cast || [])
            .slice(0, 10)
            .map((c) => ({
            name: c?.name || "",
            character: (Array.isArray(c?.roles)
                ? c.roles.map((r) => r?.character).filter(Boolean).join(", ")
                : c?.character) || "",
            profileUrl: (0, tmdbClient_1.posterUrl)(c?.profile_path, "w185"),
        }));
    }
    const mergedShow = mergeShowWithLocks(existingShow, incomingShow);
    await targetShowRef.set(mergedShow, { merge: true });
    // 3) Update the episode doc (respect its own locks)
    const episodeUpdate = {
        showRef: targetShowRef.path, // canonical path
        tmdbShowId: showDetails.id,
        showTitle: mergedShow.title || showDetails.name || null,
        overview: mergedShow.overview ?? showDetails.overview ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // optional for debugging:
        __fixMatchShowRefSource: derivedFrom,
    };
    if (!ep?.posterLocked)
        episodeUpdate.posterUrl = mergedShow.posterUrl ?? null;
    if (!ep?.backdropLocked)
        episodeUpdate.backdropUrl = mergedShow.backdropUrl ?? null;
    // (We keep logoUrl/extraVideos show-level; episode docs can read via showRef.)
    await episodeRef.set(episodeUpdate, { merge: true });
    return {
        ok: true,
        docId: episodeRef.id,
        kind: "tv",
        tmdbId: tmdbShowId,
        showRef: targetShowRef.path,
        derivedFrom,
    };
}
/** ---------- ENTRYPOINT ---------- **/
exports.default = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method Not Allowed" });
            return;
        }
        try {
            const authHeader = req.headers.authorization || "";
            if (!authHeader.startsWith("Bearer ")) {
                throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
            }
            // (Optional) verify token/uid if you want to enforce ownership
            const { collection, docId, kind, tmdbId, includeCast = true } = req.body || {};
            if (!collection || !docId || !kind || !tmdbId) {
                throw new functions.https.HttpsError("invalid-argument", "Missing required fields: collection, docId, kind, tmdbId.");
            }
            const docRef = initFirebase_1.db.doc(`${collection}/${docId}`);
            let result;
            if (String(kind) === "movie") {
                result = await handleMovieFix(docRef, Number(tmdbId), Boolean(includeCast));
            }
            else if (["tv", "show", "episode"].includes(String(kind))) {
                result = await handleTVEpisodeFix(docRef, Number(tmdbId), Boolean(includeCast));
            }
            else {
                throw new functions.https.HttpsError("invalid-argument", 'Invalid "kind" specified. Must be "movie" or "tv"/"show"/"episode".');
            }
            res.status(200).json(result);
        }
        catch (error) {
            functions.logger.error("Error in tmdbFixMatch:", error);
            const code = error?.code || "internal";
            const message = error?.message || "An internal error occurred.";
            const status = code === "unauthenticated"
                ? 401
                : code === "not-found"
                    ? 404
                    : code === "invalid-argument"
                        ? 400
                        : 500;
            res.status(status).json({ error: { code, message } });
        }
    });
});
