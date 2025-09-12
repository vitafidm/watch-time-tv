
import * as functions from 'firebase-functions';
import cors from 'cors';
import { db } from './initFirebase';
import { pickYouTubeTrailer } from './titleHelpers';
import { movieDetails, tvDetails, posterUrl, backdropUrl } from './tmdbClient';

const corsHandler = cors({ origin: true });

// Helper to check if a value is present (not null, undefined, or empty string)
const isPresent = (val: any) => val !== undefined && val !== null && val !== '';

async function handleMovieFix(docRef: FirebaseFirestore.DocumentReference, tmdbId: number, includeCast: boolean, updateDisplayTitle?: boolean) {
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Document not found.');
    }
    const data = docSnap.data()!;

    const details = await movieDetails(tmdbId);
    if (!details) {
        throw new functions.https.HttpsError('not-found', `Could not fetch movie details for TMDB ID ${tmdbId}.`);
    }

    const updatePayload: Record<string, any> = {};
    const updatedFields: string[] = [];

    const fieldMap: Record<string, () => any> = {
        tmdbId: () => details.id,
        posterUrl: () => !data.posterLocked ? posterUrl(details.poster_path, 'w500') : undefined,
        backdropUrl: () => !data.backdropLocked ? backdropUrl(details.backdrop_path, 'original') : undefined,
        overview: () => details.overview,
        releaseDate: () => details.release_date,
        genres: () => (details.genres || []).map((g: any) => g.name),
        director: () => details.credits?.crew?.find((c: any) => c.job === 'Director')?.name,
        videoLink: () => !data.videoLocked ? pickYouTubeTrailer(details.videos?.results) : undefined,
        cast: () => includeCast ? (details.credits?.cast || []).slice(0, 10).map((c: any) => ({
            name: c.name,
            character: c.character,
            profileUrl: posterUrl(c.profile_path, 'w185'),
        })) : undefined,
    };
    
    // Always update the title if the flag is set
    if (updateDisplayTitle && details.title) {
        updatePayload.title = details.title;
        updatedFields.push('title');
    }

    for (const [key, valueFn] of Object.entries(fieldMap)) {
        if (!isPresent(data[key])) {
            const value = valueFn();
            if (isPresent(value)) {
                updatePayload[key] = value;
                updatedFields.push(key);
            }
        }
    }
    
    if (Object.keys(updatePayload).length > 0) {
        await docRef.update(updatePayload);
    }
    
    return { ok: true, docId: docRef.id, kind: 'movie', tmdbId, updated: updatedFields };
}


async function handleTVEpisodeFix(docRef: FirebaseFirestore.DocumentReference, tmdbShowId: number, includeCast: boolean, updateDisplayTitle?: boolean) {
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Episode document not found.');
    }
    const data = docSnap.data()!;

    const showDetails = await tvDetails(tmdbShowId);
    if (!showDetails) {
        throw new functions.https.HttpsError('not-found', `Could not fetch TV show details for TMDB ID ${tmdbShowId}.`);
    }

    const userUid = docRef.parent.parent?.id;
    if (!userUid) {
        throw new functions.https.HttpsError('internal', 'Could not determine user from document path.');
    }
    const showRef = db.collection(`users/${userUid}/shows`).doc(String(tmdbShowId));
    
    // 1. Upsert show document
    const showUpdatePayload: Record<string, any> = {};
    const showUpdatedFields: string[] = [];
    const showDoc = await showRef.get();
    const showData = showDoc.exists ? showDoc.data()! : {};

    // Always update show title if the flag is set (or if it's new)
    if ((updateDisplayTitle || !isPresent(showData.title)) && showDetails.name) {
        showUpdatePayload.title = showDetails.name;
        showUpdatedFields.push('title');
    }

    const showFieldMap: Record<string, () => any> = {
        posterUrl: () => !showData.posterLocked ? posterUrl(showDetails.poster_path, 'w500') : undefined,
        backdropUrl: () => !showData.backdropLocked ? backdropUrl(showDetails.backdrop_path, 'original') : undefined,
        overview: () => showDetails.overview,
        genres: () => (showDetails.genres || []).map((g: any) => g.name),
        firstAirDate: () => showDetails.first_air_date,
        cast: () => includeCast ? (showDetails.aggregate_credits?.cast || []).slice(0, 10).map((c: any) => ({
            name: c.name,
            character: c.roles?.map((r: any) => r.character).join(', ') || '',
            profileUrl: posterUrl(c.profile_path, 'w185'),
        })) : undefined,
    };

    for (const [key, valueFn] of Object.entries(showFieldMap)) {
        if (!isPresent(showData[key])) {
            const value = valueFn();
            if (isPresent(value)) {
                showUpdatePayload[key] = value;
                showUpdatedFields.push(key);
            }
        }
    }
    if (Object.keys(showUpdatePayload).length > 0) {
        await showRef.set(showUpdatePayload, { merge: true });
    }

    // 2. Update episode document
    const episodeUpdatePayload: Record<string, any> = {};
    const episodeUpdatedFields: string[] = [];
    const currentShowData = { ...showData, ...showUpdatePayload };

    // Always update episode's showTitle if flag is set
    if (updateDisplayTitle && currentShowData.title) {
        episodeUpdatePayload.showTitle = currentShowData.title;
        episodeUpdatedFields.push('showTitle');
    }

    const episodeFieldMap: Record<string, () => any> = {
        showRef: () => showRef.path,
        posterUrl: () => !data.posterLocked ? currentShowData.posterUrl : undefined,
        backdropUrl: () => !data.backdropLocked ? currentShowData.backdropUrl : undefined,
        overview: () => currentShowData.overview, // Inherit show overview if episode has none
    };

    for (const [key, valueFn] of Object.entries(episodeFieldMap)) {
        if (!isPresent(data[key])) {
            const value = valueFn();
            if (isPresent(value)) {
                episodeUpdatePayload[key] = value;
                episodeUpdatedFields.push(key);
            }
        }
    }
     if (Object.keys(episodeUpdatePayload).length > 0) {
        await docRef.update(episodeUpdatePayload);
    }

    return { ok: true, docId: docRef.id, kind: 'tv', tmdbId: tmdbShowId, updated: episodeUpdatedFields };
}

export default functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method Not Allowed' });
            return;
        }

        try {
            // Basic auth check - in real app, use verifyIdToken
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
            }

            const {
                collection,
                docId,
                kind,
                tmdbId,
                includeCast = true,
                updateDisplayTitle = false
            } = req.body;

            if (!collection || !docId || !kind || !tmdbId) {
                throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: collection, docId, kind, tmdbId.');
            }

            const docRef = db.doc(`${collection}/${docId}`);

            let result;
            if (kind === 'movie') {
                result = await handleMovieFix(docRef, tmdbId, includeCast, updateDisplayTitle);
            } else if (kind === 'tv') {
                result = await handleTVEpisodeFix(docRef, tmdbId, includeCast, updateDisplayTitle);
            } else {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid "kind" specified. Must be "movie" or "tv".');
            }

            res.status(200).json(result);

        } catch (error: any) {
            functions.logger.error("Error in tmdbFixMatch:", error);
            const code = error.code || 'internal';
            const message = error.message || 'An internal error occurred.';
            res.status(code === 'unauthenticated' ? 401 : code === 'not-found' ? 404 : code === 'invalid-argument' ? 400 : 500).json({ error: { code, message } });
        }
    });
});
