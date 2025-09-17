
export type MediaDoc = {
  mediaId: string;
  title: string;
  type: 'movie' | 'episode';
  tmdbId?: number;
  tmdbShowId?: number;
  season?: number;
  episode?: number;
  year?: number;
  filename: string;
  path: string;
  serverId: string;
  addedAt?: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  
  // New matcher fields
  librarySection?: "movies" | "tv";
  normalizedTitle?: string | null;
  episodeNumber?: number | null;
  matchConfidence?: number | null;
  matchMethod?: 'title+year' | 'show+S/E' | 'manual' | null;
  manualOverride?: boolean;
  
  [key: string]: any;
};

export type ShowCacheDoc = {
  tmdbShowId: number;
  title: string;
  overview?: string | null;
  genres?: string[] | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  firstAirDate?: string | null;
  updatedAt: Date;
};

export type ShowDoc = {
  tmdbShowId: number;
  title?: string;
  displayTitle?: string;
  overview?: string | null;
  genres?: string[] | null;
  posterUrl?: string | null;
  posterLocked?: boolean;
  backdropUrl?: string | null;
  backdropLocked?: boolean;
  episodeCount?: number;
  lastAddedAt?: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
