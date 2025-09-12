import { db } from "./initFirebase";

export type CachedShow = {
  tmdbShowId: number;
  title?: string;
  overview?: string;
  genres?: string[];
  posterUrl?: string | null;
  backdropUrl?: string | null;
  firstAirDate?: string | null;
};

export async function getShowFromCache(tmdbShowId: number): Promise<CachedShow | null> {
  const ref = db.doc(`shows/${tmdbShowId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as CachedShow;
  // ensure id is present
  return { ...data, tmdbShowId };
}
