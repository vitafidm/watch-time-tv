
import { db } from "./initFirebase";
import { tvDetails, posterUrl, backdropUrl } from './tmdbClient';
import * as admin from 'firebase-admin';

export type CachedShow = {
  tmdbShowId: number;
  title?: string;
  overview?: string;
  genres?: string[];
  posterUrl?: string | null;
  backdropUrl?: string | null;
  firstAirDate?: string | null;
  updatedAt: FirebaseFirestore.Timestamp;
};

export async function getShowFromCache(tmdbShowId: number): Promise<CachedShow | null> {
  const ref = db.doc(`shows/${tmdbShowId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as CachedShow;
  // ensure id is present
  return { ...data, tmdbShowId, updatedAt: data.updatedAt };
}


export async function getShowFromCacheOrTMDB(tmdbShowId: number): Promise<CachedShow | null> {
  const cached = await getShowFromCache(tmdbShowId);
  if (cached) {
    return cached;
  }

  const details = await tvDetails(tmdbShowId);
  if (!details) {
    return null;
  }

  const showData: Omit<CachedShow, 'updatedAt'> = {
    tmdbShowId: details.id,
    title: details.name,
    overview: details.overview,
    genres: (details.genres || []).map((g: any) => g.name),
    posterUrl: posterUrl(details.poster_path, 'w500'),
    backdropUrl: backdropUrl(details.backdrop_path, 'original'),
    firstAirDate: details.first_air_date,
  };

  const newDoc: CachedShow = {
    ...showData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
  };

  await db.doc(`shows/${tmdbShowId}`).set(newDoc);

  return newDoc;
}
