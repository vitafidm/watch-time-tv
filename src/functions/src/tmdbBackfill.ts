import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './initFirebase';
import { cleanTitleForSearch, pickYouTubeTrailer } from './titleHelpers';
import { searchMovie, movieDetails, searchTV, tvDetails, posterUrl, backdropUrl } from './tmdbClient';


// Helper to check if a value is present (not null, undefined, or empty string)
const isPresent = (val: any) => val !== undefined && val !== null && val !== '';

// Simplified version for this context
function deriveShowName(ep: any): string {
    const rawPath = (ep.path || '').replace(/\\/g, '/');
    if (rawPath) {
        const segments = rawPath.split('/').filter(Boolean);
        if (segments.length > 1) {
            return segments[segments.length - 2];
        }
    }
    // Fallback to a very simple filename parse
    const rawTitle = ep.title || ep.filename || '';
    const cleaned = cleanTitleForSearch(rawTitle);
    return cleaned.title || 'Unknown Show';
}

async function handleMovie(doc: admin.firestore.DocumentSnapshot, includeCast: boolean) {
    const data = doc.data()!;
    const { title, year } = cleanTitleForSearch(data.title || data.filename);

    const searchResults = await searchMovie(title, year);
    const movieRes = searchResults?.results?.[0];
    if (!movieRes?.id) {
        return { id: doc.id, matched: null };
    }

    const details = await movieDetails(movieRes.id);
    if (!details) {
        return { id: doc.id, matched: { tmdbId: movieRes.id, title: movieRes.title } };
    }

    const updatePayload: Record<string, any> = {};

    if (!isPresent(data.posterUrl) && !data.posterLocked) {
        updatePayload.posterUrl = posterUrl(details.poster_path, 'w500');
    }
    if (!isPresent(data.backdropUrl) && !data.backdropLocked) {
        updatePayload.backdropUrl = backdropUrl(details.backdrop_path, 'w780');
    }
    if (!isPresent(data.overview)) {
        updatePayload.overview = details.overview;
    }
    if (!isPresent(data.genres)) {
        updatePayload.genres = (details.genres || []).map((g: any) => g.name);
    }
    if (!isPresent(data.releaseDate)) {
        updatePayload.releaseDate = details.release_date;
    }
    if (!isPresent(data.director)) {
        updatePayload.director = details.credits?.crew?.find((c: any) => c.job === 'Director')?.name;
    }
    if (!isPresent(data.tmdbId)) {
        updatePayload.tmdbId = details.id;
    }
    if (!isPresent(data.videoLink) && !data.videoLocked) {
        updatePayload.videoLink = pickYouTubeTrailer(details.videos?.results);
    }
    if (includeCast && !isPresent(data.cast)) {
        updatePayload.cast = (details.credits?.cast || []).slice(0, 10).map((c: any) => ({
            name: c.name,
            profileUrl: posterUrl(c.profile_path, 'w500'),
        }));
    }
    
    if (Object.keys(updatePayload).length > 0) {
        await doc.ref.update(updatePayload);
        return { id: doc.id, updated: true, matched: { tmdbId: details.id, title: details.title } };
    }
    
    return { id: doc.id, updated: false, skipped: true, matched: { tmdbId: details.id, title: details.title } };
}

async function handleEpisode(doc: admin.firestore.DocumentSnapshot, includeCast: boolean) {
    const data = doc.data()!;
    const showTitle = deriveShowName(data);

    if (showTitle === 'Unknown Show') {
        return { id: doc.id, matched: null };
    }

    const searchResults = await searchTV(showTitle);
    const showRes = searchResults?.results?.[0];
    if (!showRes?.id) {
        return { id: doc.id, matched: null };
    }
    
    const showDetails = await tvDetails(showRes.id);
    if (!showDetails) {
        return { id: doc.id, matched: { tmdbShowId: showRes.id, title: showRes.name } };
    }

    const showRef = db.collection('shows').doc(String(showDetails.id));
    
    // Create/merge show doc
    const showUpdate: Record<string, any> = {};
    const showDoc = await showRef.get();
    const showData = showDoc.exists ? showDoc.data()! : {};

    if (!isPresent(showData.posterUrl) && !showData.posterLocked) showUpdate.posterUrl = posterUrl(showDetails.poster_path, 'w500');
    if (!isPresent(showData.backdropUrl) && !showData.backdropLocked) showUpdate.backdropUrl = backdropUrl(showDetails.backdrop_path, 'w780');
    if (!isPresent(showData.overview)) showUpdate.overview = showDetails.overview;
    if (!isPresent(showData.genres)) showUpdate.genres = (showDetails.genres || []).map((g: any) => g.name);
    if (!isPresent(showData.firstAirDate)) showUpdate.firstAirDate = showDetails.first_air_date;
    if (!isPresent(showData.tmdbShowId)) showUpdate.tmdbShowId = showDetails.id;
    if (!isPresent(showData.title)) showUpdate.title = showDetails.name;
    
    if (includeCast && !isPresent(showData.cast)) {
        showUpdate.cast = (showDetails.aggregate_credits?.cast || []).slice(0, 10).map((c: any) => ({
            name: c.name,
            profileUrl: posterUrl(c.profile_path, 'w500'),
        }));
    }

    if (Object.keys(showUpdate).length > 0) {
        await showRef.set(showUpdate, { merge: true });
    }

    // Update episode doc
    const episodeUpdate: Record<string, any> = {};
    if (!isPresent(data.posterUrl) && !data.posterLocked) episodeUpdate.posterUrl = showUpdate.posterUrl ?? showData.posterUrl;
    if (!isPresent(data.overview)) episodeUpdate.overview = showUpdate.overview ?? showData.overview;
    if (!isPresent(data.showTitle)) episodeUpdate.showTitle = showUpdate.title ?? showData.title;
    if (!isPresent(data.showRef)) episodeUpdate.showRef = showRef.path;

    if (Object.keys(episodeUpdate).length > 0) {
        await doc.ref.update(episodeUpdate);
        return { id: doc.id, updated: true, matched: { tmdbShowId: showDetails.id, title: showDetails.name } };
    }

    return { id: doc.id, updated: false, skipped: true, matched: { tmdbShowId: showDetails.id, title: showDetails.name } };
}

export default functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const {
        collection: coll = 'media',
        kind = 'any',
        batchSize = 50,
        dryRun = true,
        startAfterId,
        includeCast = false,
    } = req.body;

    const limit = Math.min(200, Math.max(1, batchSize));
    let query: admin.firestore.Query = db.collection(coll).orderBy(admin.firestore.FieldPath.documentId()).limit(limit);

    if (kind !== 'any') {
        query = query.where('type', '==', kind);
    }
    if (startAfterId) {
        const startAfterDoc = await db.collection(coll).doc(startAfterId).get();
        if (startAfterDoc.exists) {
            query = query.startAfter(startAfterDoc);
        }
    }

    const snapshot = await query.get();
    let checked = 0;
    let updated = 0;
    let skippedExisting = 0;
    const examples: any[] = [];
    let nextStartAfterId: string | null = null;
    
    if (snapshot.empty) {
        res.status(200).json({ message: "No documents found matching query." });
        return;
    }

    for (const doc of snapshot.docs) {
        checked++;
        nextStartAfterId = doc.id;

        const data = doc.data();
        let result: any;
        
        try {
            if (data.type === 'movie') {
                if (dryRun) {
                    examples.push({ id: doc.id });
                } else {
                    result = await handleMovie(doc, includeCast);
                }
            } else if (data.type === 'episode') {
                if (dryRun) {
                    examples.push({ id: doc.id });
                } else {
                   result = await handleEpisode(doc, includeCast);
                }
            }

            if(result) {
                if (result.updated) updated++;
                if (result.skipped) skippedExisting++;
                examples.push({ id: doc.id, matched: result.matched });
            }
        } catch (error: any) {
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
