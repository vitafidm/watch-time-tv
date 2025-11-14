'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import { useAuthUser } from '@/hooks/useAuthUser';
import { db } from '@/lib/firebase.client';
import { doc, getDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { WatchlistButton } from '@/components/watchlist-button';
import { PlayerDialog } from '@/components/PlayerDialog';
import { CastSection } from '@/components/CastSection';
import { cn } from '@/lib/utils';

type MovieDoc = {
  type?: string;            // "movie"
  mediaId?: string;         // streamable id
  title?: string;
  normalizedTitle?: string;
  overview?: string;
  description?: string;
  backdropUrl?: string | null;
  posterUrl?: string | null;
  genres?: string[];
  genreNames?: string[];
  genresList?: string[];
  releaseDate?: string;
  voteAverage?: number;
  cast?: Array<{ name: string; character?: string; profileUrl?: string | null }>;
};

function normalizeGenres(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    if (typeof raw[0] === 'string') return raw as string[];
    if (typeof raw[0] === 'object' && raw[0]?.name) {
      return (raw as Array<{ name?: string }>).map(g => g?.name).filter(Boolean) as string[];
    }
  }
  if (Array.isArray(raw?.genreNames)) return raw.genreNames as string[];
  if (Array.isArray(raw?.genresList)) return raw.genresList as string[];
  return [];
}

export default function MovieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuthUser();
  const { id } = use(params);

  const [movie, setMovie] = useState<MovieDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  useEffect(() => {
    if (!user?.uid || !id) {
      if (!user) setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const ref = doc(db, `users/${user.uid}/media`, id);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setErr('Movie not found.');
          setMovie(null);
          return;
        }
        const d = snap.data() as MovieDoc;
        if (d?.type && d.type !== 'movie') {
          setErr('This item is not a movie.');
          setMovie(null);
          return;
        }
        setMovie(d);
      } catch (e: any) {
        setErr(e?.message || 'Failed to fetch movie.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.uid, id]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 space-y-8">
        <Skeleton className="h-[70vh] w-full" />
        <Skeleton className="h-10 w-1/4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="container mx-auto p-4 text-center text-red-400">
        <h1 className="font-headline text-2xl font-bold mb-4">Error</h1>
        <p>{err}</p>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h1 className="font-headline text-2xl font-bold mb-4">Movie Not Found</h1>
        <p>The requested movie could not be found in your library.</p>
      </div>
    );
  }

  const title =
    (movie.normalizedTitle && movie.normalizedTitle.trim()) ||
    movie.title ||
    'Untitled';

  const backdrop = movie.backdropUrl || movie.posterUrl || '';
  const poster = movie.posterUrl || '';
  const overview = movie.overview || movie.description || '';
  const genres = normalizeGenres(movie.genres ?? movie.genreNames ?? movie.genresList);
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : undefined;

  return (
    <div className="container space-y-10" data-testid="movie-detail">
      {/* Hero */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl">
        {backdrop ? (
          <Image src={backdrop} alt={title} fill className="object-cover" priority />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

        <div className="absolute inset-0 flex items-center p-6 sm:p-10">
          <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-4">
            <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground drop-shadow-2xl">
              {title}{year ? <span className="ml-3 text-foreground/70 text-3xl md:text-4xl">({year})</span> : null}
            </h1>

            {overview ? (
              <p className="line-clamp-2 sm:line-clamp-3 md:line-clamp-none text-sm sm:text-base text-foreground/80 leading-relaxed drop-shadow">
                {overview}
              </p>
            ) : null}

            {genres.length > 0 && (
              <div className="hidden sm:flex flex-wrap items-center gap-2">
                {genres.slice(0, 8).map((g) => (
                  <Badge key={g} variant="secondary">{g}</Badge>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button size="lg" className="font-bold" onClick={() => setPlayerOpen(true)} disabled={!movie.mediaId}>
                <Play className="mr-2" />
                Play
              </Button>

              <WatchlistButton
                item={{
                  id: movie.mediaId || id,
                  title,
                  overview,
                  poster_path: poster,
                  backdrop_path: backdrop,
                  release_date: movie.releaseDate || '',
                  vote_average: movie.voteAverage || 0,
                  genres,
                  media_type: 'movie',
                }}
                variant="secondary"
                className="font-bold"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Watch now */}
      <section>
        <h2 className="mb-3 font-headline text-xl font-semibold">Watch now</h2>
        <button
          type="button"
          onClick={() => setPlayerOpen(true)}
          className={cn(
            'group relative inline-block overflow-hidden rounded-xl',
            'w-[180px] sm:w-[220px] md:w-[260px] aspect-[2/3] bg-muted'
          )}
          aria-label={`Play ${title}`}
          disabled={!movie.mediaId}
        >
          {poster ? (
            <Image
              src={poster}
              alt={title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              sizes="260px"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">No poster</div>
          )}
          <div
            className={cn(
              'pointer-events-none absolute inset-0 grid place-items-center opacity-0',
              'transition-opacity duration-200 group-hover:opacity-100 bg-black/35'
            )}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white shadow-lg">
              <Play className="h-6 w-6" />
            </span>
          </div>
        </button>
      </section>

      {Array.isArray(movie.cast) && movie.cast.length > 0 && <CastSection cast={movie.cast} />}

      <PlayerDialog
        open={playerOpen}
        onOpenChange={setPlayerOpen}
        mediaId={movie.mediaId ?? id}
        title={title}
      />
    </div>
  );
}
