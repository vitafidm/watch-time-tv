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
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const initFirebase_1 = require("./initFirebase");
const titleHelpers_1 = require("./titleHelpers");
const tmdbClient_1 = require("./tmdbClient");
// Helper to check if a value is present (not null, undefined, or empty string)
const isPresent = (val) => val !== undefined && val !== null && val !== '';
// Simplified version for this context
function deriveShowName(ep) {
    const rawPath = (ep.path || '').replace(/\\/g, '/');
    if (rawPath) {
        const segments = rawPath.split('/').filter(Boolean);
        if (segments.length > 1) {
            // This is a naive assumption, real logic would be more complex
            return segments[segments.length - 2];
        }
    }
    // Fallback to a very simple filename parse
    const rawTitle = ep.title || ep.filename || '';
    const cleaned = (0, titleHelpers_1.cleanTitleForSearch)(rawTitle);
    return cleaned.title || 'Unknown Show';
}
async function handleMovie(doc, includeCast) {
    const data = doc.data();
    const { title, year } = (0, titleHelpers_1.cleanTitleForSearch)(data.title || data.filename);
    const searchResults = await (0, tmdbClient_1.searchMovie)(title, year);
    const movieRes = searchResults?.results?.[0];
    if (!movieRes?.id) {
        return { id: doc.id, matched: null };
    }
    const details = await (0, tmdbClient_1.movieDetails)(movieRes.id);
    if (!details) {
        return { id: doc.id, matched: { tmdbId: movieRes.id, title: movieRes.title } };
    }
    const updatePayload = {};
    if (!isPresent(data.posterUrl) && !data.posterLocked) {
        updatePayload.posterUrl = (0, tmdbClient_1.posterUrl)(details.poster_path, 'w500');
    }
    if (!isPresent(data.backdropUrl) && !data.backdropLocked) {
        updatePayload.backdropUrl = (0, tmdbClient_1.backdropUrl)(details.backdrop_path, 'original');
    }
    if (!isPresent(data.overview)) {
        updatePayload.overview = details.overview;
    }
    if (!isPresent(data.genres)) {
        updatePayload.genres = (details.genres || []).map((g) => g.name);
    }
    if (!isPresent(data.releaseDate)) {
        updatePayload.releaseDate = details.release_date;
    }
    if (!isPresent(data.director)) {
        updatePayload.director = details.credits?.crew?.find((c) => c.job === 'Director')?.name;
    }
    if (!isPresent(data.tmdbId)) {
        updatePayload.tmdbId = details.id;
    }
    if (!isPresent(data.videoLink) && !data.videoLocked) {
        updatePayload.videoLink = (0, titleHelpers_1.pickYouTubeTrailer)(details.videos?.results);
    }
    if (includeCast && !isPresent(data.cast)) {
        updatePayload.cast = (details.credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            profileUrl: (0, tmdbClient_1.posterUrl)(c.profile_path, 'w185'),
        }));
    }
    if (Object.keys(updatePayload).length > 0) {
        await doc.ref.update(updatePayload);
        return { id: doc.id, updated: true, matched: { tmdbId: details.id, title: details.title } };
    }
    return { id: doc.id, updated: false, skipped: true, matched: { tmdbId: details.id, title: details.title } };
}
async function handleEpisode(doc, includeCast) {
    const data = doc.data();
    const showTitle = deriveShowName(data);
    if (showTitle === 'Unknown Show') {
        return { id: doc.id, matched: null };
    }
    const searchResults = await (0, tmdbClient_1.searchTV)(showTitle);
    const showRes = searchResults?.results?.[0];
    if (!showRes?.id) {
        return { id: doc.id, matched: null };
    }
    const showDetails = await (0, tmdbClient_1.tvDetails)(showRes.id);
    if (!showDetails) {
        return { id: doc.id, matched: { tmdbShowId: showRes.id, title: showRes.name } };
    }
    const userUid = doc.ref.parent.parent?.id;
    if (!userUid) {
        throw new Error('Could not determine user from doc path');
    }
    const showRef = initFirebase_1.db.collection(`users/${userUid}/shows`).doc(String(showDetails.id));
    // Create/merge show doc
    const showUpdate = {};
    const showDoc = await showRef.get();
    const showData = showDoc.exists ? showDoc.data() : {};
    if (!isPresent(showData.posterUrl) && !showData.posterLocked)
        showUpdate.posterUrl = (0, tmdbClient_1.posterUrl)(showDetails.poster_path, 'w500');
    if (!isPresent(showData.backdropUrl) && !showData.backdropLocked)
        showUpdate.backdropUrl = (0, tmdbClient_1.backdropUrl)(showDetails.backdrop_path, 'original');
    if (!isPresent(showData.overview))
        showUpdate.overview = showDetails.overview;
    if (!isPresent(showData.genres))
        showUpdate.genres = (showDetails.genres || []).map((g) => g.name);
    if (!isPresent(showData.firstAirDate))
        showUpdate.firstAirDate = showDetails.first_air_date;
    if (!isPresent(showData.tmdbShowId))
        showUpdate.tmdbShowId = showDetails.id;
    if (!isPresent(showData.title))
        showUpdate.title = showDetails.name;
    if (includeCast && !isPresent(showData.cast)) {
        showUpdate.cast = (showDetails.aggregate_credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            profileUrl: (0, tmdbClient_1.posterUrl)(c.profile_path, 'w185'),
        }));
    }
    if (Object.keys(showUpdate).length > 0) {
        await showRef.set(showUpdate, { merge: true });
    }
    // Update episode doc
    const episodeUpdate = {};
    const currentShowData = { ...showData, ...showUpdate };
    if (!isPresent(data.posterUrl) && !data.posterLocked)
        episodeUpdate.posterUrl = currentShowData.posterUrl;
    if (!isPresent(data.overview))
        episodeUpdate.overview = currentShowData.overview;
    if (!isPresent(data.showTitle))
        episodeUpdate.showTitle = currentShowData.title;
    if (!isPresent(data.showRef))
        episodeUpdate.showRef = showRef.path;
    if (Object.keys(episodeUpdate).length > 0) {
        await doc.ref.update(episodeUpdate);
        return { id: doc.id, updated: true, matched: { tmdbShowId: showDetails.id, title: showDetails.name } };
    }
    return { id: doc.id, updated: false, skipped: true, matched: { tmdbShowId: showDetails.id, title: showDetails.name } };
}
exports.default = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const { collection: coll = 'media', kind = 'any', batchSize = 50, dryRun = true, startAfterId, includeCast = false, } = req.body;
    const limit = Math.min(200, Math.max(1, batchSize));
    const userUid = req.get('x-user-uid'); // Example of getting user context. In real app, use auth token.
    if (!userUid) {
        res.status(401).json({ message: "User not authenticated" });
        return;
    }
    const collectionPath = `users/${userUid}/${coll}`;
    let query = initFirebase_1.db.collection(collectionPath).orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
    if (kind !== 'any') {
        query = query.where('type', '==', kind);
    }
    if (startAfterId) {
        const startAfterDoc = await initFirebase_1.db.collection(collectionPath).doc(startAfterId).get();
        if (startAfterDoc.exists) {
            query = query.startAfter(startAfterDoc);
        }
    }
    const snapshot = await query.get();
    let checked = 0;
    let updated = 0;
    let skippedExisting = 0;
    const examples = [];
    let nextStartAfterId = null;
    if (snapshot.empty) {
        res.status(200).json({ message: "No documents found matching query." });
        return;
    }
    for (const doc of snapshot.docs) {
        checked++;
        nextStartAfterId = doc.id;
        const data = doc.data();
        let result;
        try {
            if (data.type === 'movie') {
                if (dryRun) {
                    examples.push({ id: doc.id });
                }
                else {
                    result = await handleMovie(doc, includeCast);
                }
            }
            else if (data.type === 'episode') {
                if (dryRun) {
                    examples.push({ id: doc.id });
                }
                else {
                    result = await handleEpisode(doc, includeCast);
                }
            }
            if (result) {
                if (result.updated)
                    updated++;
                if (result.skipped)
                    skippedExisting++;
                examples.push({ id: doc.id, matched: result.matched });
            }
        }
        catch (error) {
            functions.logger.error(`Failed to process doc ${doc.id}:`, error);
            examples.push({ id: doc.id, error: error.message });
        }
    }
    res.status(200).json({
        checked,
        updated,
        skippedExisting,
        dryRun,
        nextStartAfterId,
        examples: examples.slice(0, 10),
    });
});
//# sourceMappingURL=tmdbBackfill.js.map