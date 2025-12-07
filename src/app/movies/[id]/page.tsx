'use client';

import { useState, useEffect, use, useMemo } from 'react';
import Image from 'next/image';
import { useAuthUser } from '@/hooks/useAuthUser';
import { db } from '@/lib/firebase.client';
import { doc, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, Play } from 'lucide-react';
import { WatchlistButton } from '@/components/watchlist-button';
import { PlayerDialog } from '@/components/PlayerDialog';
import { CastSection } from '@/components/CastSection';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ExtraVideosSections } from "@/components/ExtraVideosSections";


type MovieDoc = {
  type?: string; // "movie"
  mediaId?: string; // streamable id
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
  videoLink?: string | null; // optional trailer link (YouTube, etc.)
  logoUrl?: string | null;   // logo for hero
  extraVideos?: any[] | null;
};

function normalizeGenres(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    if (typeof raw[0] === 'string') return raw as string[];
    if (typeof raw[0] === 'object' && raw[0]?.name) {
      return (raw as Array<{ name?: string }>)
        .map((g) => g?.name)
        .filter(Boolean) as string[];
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

function getYouTubeId(url: string): string | null {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

type VideoPhase = 'preload' | 'playing' | 'finished';

export default function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    const unsub = onSnapshot(ref, (snap) => {
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

  // Trailer support (same pattern as Featured/ShowHero)
  const videoId = useMemo(() => {
    const link = (movie as any)?.videoLink;
    if (typeof link === 'string' && link.trim()) {
      return getYouTubeId(link);
    }
    return null;
  }, [movie]);

  const [phase, setPhase] = useState<VideoPhase>(
    videoId ? 'preload' : 'finished'
  );

  useEffect(() => {
    if (!videoId) return;

    if (phase === 'preload') {
      const playTimer = setTimeout(() => setPhase('playing'), 6000);
      return () => clearTimeout(playTimer);
    }

    if (phase === 'playing') {
      const finishTimer = setTimeout(() => setPhase('finished'), 20000);
      return () => clearTimeout(finishTimer);
    }
  }, [phase, videoId]);

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
        <h1 className="font-headline text-2xl font-bold mb-4">
          Movie Not Found
        </h1>
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
  const genres = normalizeGenres(
    movie.genres ?? movie.genreNames ?? movie.genresList
  );
  const year = movie.releaseDate
    ? new Date(movie.releaseDate).getFullYear()
    : undefined;

  const hasResume =
    typeof resumeSeconds === 'number' &&
    resumeSeconds >= 10 &&
    progressPct > 0 &&
    progressPct < 100;

  const playbackMediaId = movie.mediaId ?? id;

  const logo = (movie as any).logoUrl as string | undefined; // 🔹 used in hero

  return (
    <div className="container space-y-10" data-testid="movie-detail">
      {/* Hero – Apple TV–style, matches Horizontal Posters - Featured / ShowHero */}
      <div className="relative w-full overflow-hidden rounded-xl aspect-[4/5] sm:aspect-video">
        {/* Background: trailer + backdrop image */}
        <div className="absolute inset-0 bg-black">
          {videoId && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&iv_load_policy=3&modestbranding=1`}
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000',
                'scale-[2]',
                phase === 'playing'
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none'
              )}
            />
          )}

          {backdrop ? (
            <Image
              src={backdrop}
              alt={title}
              fill
              priority
              className={cn(
                'object-cover transition-opacity duration-1000',
                'scale-[1.12] sm:scale-100',
                videoId && phase === 'playing'
                  ? 'opacity-0'
                  : 'opacity-100'
              )}
            />
          ) : (
            <div className="absolute inset-0 bg-muted" />
          )}
        </div>

        {/* Gradient overlay (left-right, no top-to-bottom wash) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />

        {/* Content: bottom/center on mobile, left-aligned on larger screens */}
        <div className="absolute inset-0 flex items-end justify-center px-4 py-6 sm:items-center sm:justify-start sm:p-8">
          <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-3 sm:space-y-4 text-center sm:text-left">
            {/* 🔹 Logo + title fallback + year */}
            <h1 className="font-headline text-white drop-shadow-2xl flex flex-col items-center sm:items-start gap-2">
              <div className="relative mx-auto sm:mx-0 h-16 sm:h-20 md:h-[11rem] w-full max-w-xs sm:max-w-sm md:max-w-md flex items-center justify-center sm:justify-start">
                {logo ? (
                  <Image
                    src={logo}
                    alt={title}
                    fill
                    className="object-contain object-center sm:object-[left_bottom]"
                    priority
                  />
                ) : (
                  <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">
                    {title}
                  </span>
                )}
              </div>
              
            </h1>

            {overview && (
              <p className="line-clamp-2 sm:line-clamp-3 text-sm sm:text-base text-white/80 leading-relaxed drop-shadow-lg">
                {overview}
              </p>
            )}

            {genres.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm font-semibold text-white sm:justify-start">
                {genres.slice(0, 4).map((g, idx) => (
                  <span key={g} className="flex items-center gap-1">
                    {idx > 0 && (
                      <span className="opacity-75" aria-hidden="true">
                        •
                      </span>
                    )}
                    <span className="opacity-90">{g}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2 sm:justify-start">
              {playbackMediaId && (
                <button
                  type="button"
                  onClick={() => {
                    setPlayerStartTime(hasResume ? resumeSeconds! : null);
                    setPlayerOpen(true);
                  }}
                  className={cn(
                    'inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-bold shadow-lg',
                    'w-[55%] sm:w-[55%] max-w-xs mx-auto sm:mx-0',
                    'bg-[#f5f5f5] text-[#2f4f4f]'
                  )}
                >
                  {hasResume ? 'Resume' : 'Watch Now'}
                </button>
              )}
              {/* No Watchlist button in hero to match Featured / ShowHero */}
            </div>
          </div>
        </div>

        {/* Bottom progress bar on hero */}
        {progressPct > 0 && progressPct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
            <div
              className="h-full bg-white/90"
              style={{ width: `${progressPct}%` }}
              aria-hidden="true"
            />
          </div>
        )}
      </div>

{/*
     
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

          
          <div
            className={cn(
              'pointer-events-none absolute inset-0 grid place-items-center opacity-0',
              'transition-opacity duration-200 group-hover:opacity-100 bg-black/35'
            )}
          >
            <span className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black/70 text-white shadow-lg px-4 h-11 text-sm font-bold">
              <Play className="h-4 w-4 mr-2" />
              {hasResume
                ? `Resume • ${formatTimeShort(resumeSeconds)}`
                : 'Play'}
            </span>
          </div>

          
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

      <div className="pb-[5px]">
         <hr className="border-border" />
      </div>
*/}

      <ExtraVideosSections videos={(movie as any).extraVideos} />

      <div className="pb-[5px]">
         <hr className="border-border" />
      </div>

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
