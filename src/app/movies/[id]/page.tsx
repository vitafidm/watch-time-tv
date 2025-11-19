'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import { useAuthUser } from '@/hooks/useAuthUser';
import { db } from '@/lib/firebase.client';
import { doc, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Check } from 'lucide-react';
import { WatchlistButton } from '@/components/watchlist-button';
import { PlayerDialog } from '@/components/PlayerDialog';
import { CastSection } from '@/components/CastSection';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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

function formatTimeShort(sec?: number | null) {
  if (!sec || sec <= 0) return '0:00';
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  const m = Math.floor(sec / 60);
  return `${m}:${s}`;
}

export default function MovieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuthUser();
  const { toast } = useToast();
  const { id } = use(params);

  const [movie, setMovie] = useState<MovieDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerStartTime, setPlayerStartTime] = useState<number | null>(null);

  // Resume / progress for this specific movie
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);

  // Fetch movie metadata
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

  // Subscribe to playback for this movie (resume/progress)
  useEffect(() => {
    if (!user?.uid) return;
    if (!movie) {
      setResumeSeconds(null);
      setProgressPct(0);
      return;
    }

    const playbackId = movie.mediaId ?? id;
    if (!playbackId) {
      setResumeSeconds(null);
      setProgressPct(0);
      return;
    }

    const ref = doc(db, `users/${user.uid}/playback`, playbackId);
    const unsub = onSnapshot(ref, snap => {
      if (!snap.exists()) {
        setResumeSeconds(null);
        setProgressPct(0);
        return;
      }
      const d = snap.data() as any;
      const pos = Math.floor(d.lastPosition ?? d.position ?? 0);
      const dur = Math.max(1, Math.floor(d.duration ?? 0));
      const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;

      // Treat ~finished items as non-resumable
      if (pct >= 96) {
        setResumeSeconds(null);
        setProgressPct(100);
      } else {
        setResumeSeconds(pos);
        setProgressPct(pct);
      }
    });

    return () => unsub();
  }, [user?.uid, movie, id]);

  const handleMarkWatched = async () => {
    if (!user?.uid || !movie) return;
    const playbackId = movie.mediaId ?? id;
    if (!playbackId) return;

    try {
      await deleteDoc(doc(db, `users/${user.uid}/playback`, playbackId));
      setResumeSeconds(null);
      setProgressPct(0);
      toast({ title: 'Marked as watched' });
    } catch (e: any) {
      toast({
        title: 'Failed to mark as watched',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    }
  };

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

  const hasResume =
    typeof resumeSeconds === 'number' &&
    resumeSeconds >= 10 &&
    progressPct > 0 &&
    progressPct < 100;

  const primaryCtaLabel = hasResume
    ? `Resume • ${formatTimeShort(resumeSeconds)}`
    : 'Play';

  const playbackMediaId = movie.mediaId ?? id;

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
              {title}
              {year ? (
                <span className="ml-3 text-foreground/70 text-3xl md:text-4xl">
                  ({year})
                </span>
              ) : null}
            </h1>

            {overview ? (
              <p className="line-clamp-2 sm:line-clamp-3 md:line-clamp-none text-sm sm:text-base text-foreground/80 leading-relaxed drop-shadow">
                {overview}
              </p>
            ) : null}

            {genres.length > 0 && (
              <div className="hidden sm:flex flex-wrap items-center gap-2">
                {genres.slice(0, 8).map((g) => (
                  <Badge key={g} variant="secondary">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="lg"
                className="font-bold"
                onClick={() => {
                  setPlayerStartTime(hasResume ? resumeSeconds! : null);
                  setPlayerOpen(true);
                }}
                disabled={!playbackMediaId}
              >
                <Play className="mr-2" />
                {primaryCtaLabel}
              </Button>

              {/* Mark-as-watched removed from hero on purpose */}

              <WatchlistButton
                item={{
                  id: playbackMediaId,
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
          onClick={() => {
            setPlayerStartTime(hasResume ? resumeSeconds! : null);
            setPlayerOpen(true);
          }}
          className={cn(
            'group relative inline-block overflow-hidden rounded-xl',
            'w-[180px] sm:w-[220px] md:w-[260px] aspect-[2/3] bg-muted'
          )}
          aria-label={`${hasResume ? 'Resume' : 'Play'} ${title}`}
          disabled={!playbackMediaId}
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
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              No poster
            </div>
          )}

          {/* Mark as watched pill (top-right) – now NOT a button to avoid nesting button-in-button */}
          {hasResume && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleMarkWatched();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleMarkWatched();
                }
              }}
              className="
                absolute top-2 right-2 z-20
                inline-flex items-center gap-1 rounded-full
                bg-black/70 px-2.5 py-1 text-xs font-semibold text-white
                shadow-sm ring-1 ring-white/20
                cursor-pointer
              "
              title="Mark as watched"
              aria-label="Mark as watched"
            >
              <Check className="h-3.5 w-3.5" />
              Mark as watched
            </div>
          )}

          {/* Center overlay: Play / Resume */}
          <div
            className={cn(
              'pointer-events-none absolute inset-0 grid place-items-center opacity-0',
              'transition-opacity duration-200 group-hover:opacity-100 bg-black/35'
            )}
          >
            <span className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black/70 text-white shadow-lg px-4 h-11 text-sm font-bold">
              <Play className="h-4 w-4 mr-2" />
              {hasResume ? `Resume • ${formatTimeShort(resumeSeconds)}` : 'Play'}
            </span>
          </div>

          {/* Bottom progress bar */}
          {progressPct > 0 && progressPct < 100 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
              <div
                className="h-full bg-white/90"
                style={{ width: `${progressPct}%` }}
                aria-hidden="true"
              />
            </div>
          )}
        </button>
      </section>

      {Array.isArray(movie.cast) && movie.cast.length > 0 && (
        <CastSection cast={movie.cast} />
      )}

      <PlayerDialog
        open={playerOpen}
        onOpenChange={setPlayerOpen}
        mediaId={playbackMediaId}
        title={title}
        startTime={playerStartTime}
      />
    </div>
  );
}
