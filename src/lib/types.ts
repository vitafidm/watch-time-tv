export type MediaItem = {
  id: number;
  title: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date: string;
  vote_average: number;
  genres: string[];
  media_type: 'movie' | 'tv';
  logo_path?: string | null;
  videoLink?: string;
  tmdbId?: number | null;
};
