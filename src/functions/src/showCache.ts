import { db } from './initFirebase';
import { tvDetails, posterUrl, backdropUrl } from './tmdbClient';
import type { ShowCacheDoc } from './types';

/**
 * Fetches TV show details from a global cache or from TMDB if not present.
 * Caches the result in Firestore at /shows/{tmdbShowId}.
 *
 * @param tmdbShowId The TMDB ID of the TV show.
 * @returns The cached or newly fetched show data.
 */
export async function getShowFromCacheOrTMDB(tmdbShowId: number): Promise<ShowCacheDoc | null> {
  const cacheRef = db.collection('shows').doc(String(tmdbShowId));
  const cacheSnap = await cacheRef.get();

  if (cacheSnap.exists) {
    return cacheSnap.data() as ShowCacheDoc;
  }

  const details = await tvDetails(tmdbShowId);
  if (!details) {
    return null;
  }

  const newCacheData: ShowCacheDoc = {
    tmdbShowId: details.id,
    title: details.name,
    overview: details.overview,
    genres: (details.genres || []).map((g: any) => g.name),
    posterUrl: posterUrl(details.poster_path, 'w500'),
    backdropUrl: backdropUrl(details.backdrop_path, 'original'),
    firstAirDate: details.first_air_date,
    updatedAt: new Date(),
  };

  await cacheRef.set(newCacheData, { merge: true });

  return newCacheData;
}
