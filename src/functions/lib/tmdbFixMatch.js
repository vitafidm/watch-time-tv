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
const admin = __importStar(require("firebase-admin"));
const initFirebase_1 = require("./initFirebase");
const titleHelpers_1 = require("./titleHelpers");
const tmdbClient_1 = require("./tmdbClient");
const corsHandler = (0, cors_1.default)({ origin: true });
async function handleMovieFix(docRef, tmdbId, includeCast) {
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Document not found.');
    }
    const data = docSnap.data();
    const details = await (0, tmdbClient_1.movieDetails)(tmdbId);
    if (!details) {
        throw new functions.https.HttpsError('not-found', `Could not fetch movie details for TMDB ID ${tmdbId}.`);
    }
    const updatePayload = {
        tmdbId: details.id,
        tmdbType: 'movie',
        title: details.title,
        normalizedTitle: details.title, // Overwrite with new source of truth
        overview: details.overview,
        releaseDate: details.release_date,
        genres: (details.genres || []).map((g) => g.name),
        director: details.credits?.crew?.find((c) => c.job === 'Director')?.name,
        voteAverage: details.vote_average,
        language: details.original_language,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (includeCast) {
        updatePayload.cast = (details.credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            character: c.character,
            profileUrl: (0, tmdbClient_1.posterUrl)(c.profile_path, 'w185'),
        }));
    }
    // Conditionally update based on user locks
    if (!data.posterLocked) {
        updatePayload.posterUrl = (0, tmdbClient_1.posterUrl)(details.poster_path, 'w500');
    }
    if (!data.backdropLocked) {
        updatePayload.backdropUrl = (0, tmdbClient_1.backdropUrl)(details.backdrop_path, 'original');
    }
    if (!data.videoLocked) {
        updatePayload.videoLink = (0, titleHelpers_1.pickYouTubeTrailer)(details.videos?.results);
    }
    await docRef.update(updatePayload);
    return { ok: true, docId: docRef.id, kind: 'movie', tmdbId };
}
async function handleTVEpisodeFix(docRef, tmdbShowId, includeCast) {
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Episode document not found.');
    }
    const data = docSnap.data();
    const showDetails = await (0, tmdbClient_1.tvDetails)(tmdbShowId);
    if (!showDetails) {
        throw new functions.https.HttpsError('not-found', `Could not fetch TV show details for TMDB ID ${tmdbShowId}.`);
    }
    const userUid = docRef.parent.parent?.id;
    if (!userUid) {
        throw new functions.https.HttpsError('internal', 'Could not determine user from document path.');
    }
    const showRef = initFirebase_1.db.collection(`users/${userUid}/shows`).doc(String(tmdbShowId));
    // 1. Upsert show document
    const showDoc = await showRef.get();
    const showData = showDoc.exists ? showDoc.data() : {};
    const showUpdatePayload = {
        tmdbId: showDetails.id,
        tmdbType: 'tv',
        title: showDetails.name,
        normalizedTitle: showDetails.name,
        overview: showDetails.overview,
        genres: (showDetails.genres || []).map((g) => g.name),
        firstAirDate: showDetails.first_air_date,
        voteAverage: showDetails.vote_average,
        language: showDetails.original_language,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (includeCast) {
        showUpdatePayload.cast = (showDetails.aggregate_credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            character: c.roles?.map((r) => r.character).join(', ') || '',
            profileUrl: (0, tmdbClient_1.posterUrl)(c.profile_path, 'w185'),
        }));
    }
    if (!showData.posterLocked) {
        showUpdatePayload.posterUrl = (0, tmdbClient_1.posterUrl)(showDetails.poster_path, 'w500');
    }
    if (!showData.backdropLocked) {
        showUpdatePayload.backdropUrl = (0, tmdbClient_1.backdropUrl)(showDetails.backdrop_path, 'original');
    }
    await showRef.set(showUpdatePayload, { merge: true });
    // 2. Update episode document
    const episodeUpdatePayload = {
        showRef: showRef.path,
        tmdbShowId: showDetails.id,
        showTitle: showDetails.name,
        overview: showDetails.overview, // Inherit show overview
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!data.posterLocked) {
        episodeUpdatePayload.posterUrl = showUpdatePayload.posterUrl;
    }
    if (!data.backdropLocked) {
        episodeUpdatePayload.backdropUrl = showUpdatePayload.backdropUrl;
    }
    await docRef.update(episodeUpdatePayload);
    return { ok: true, docId: docRef.id, kind: 'tv', tmdbId: tmdbShowId };
}
exports.default = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method Not Allowed' });
            return;
        }
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
            }
            const { collection, docId, kind, tmdbId, includeCast = true, } = req.body;
            if (!collection || !docId || !kind || !tmdbId) {
                throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: collection, docId, kind, tmdbId.');
            }
            const docRef = initFirebase_1.db.doc(`${collection}/${docId}`);
            let result;
            if (kind === 'movie') {
                result = await handleMovieFix(docRef, tmdbId, includeCast);
            }
            else if (kind === 'tv' || kind === 'show' || kind === 'episode') { // Be lenient on 'kind' input
                result = await handleTVEpisodeFix(docRef, tmdbId, includeCast);
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid "kind" specified. Must be "movie" or "tv"/"show"/"episode".');
            }
            res.status(200).json(result);
        }
        catch (error) {
            functions.logger.error("Error in tmdbFixMatch:", error);
            const code = error.code || 'internal';
            const message = error.message || 'An internal error occurred.';
            res.status(code === 'unauthenticated' ? 401 : code === 'not-found' ? 404 : code === 'invalid-argument' ? 400 : 500).json({ error: { code, message } });
        }
    });
});
