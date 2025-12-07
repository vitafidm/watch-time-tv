// src/components/HomepageHero.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaItem } from '@/lib/types';
import { WatchlistButton } from '@/components/watchlist-button';

export type HeroData = {
  // NOTE: id is optional because some callers may only provide tmdbId
  id?: string | number;
  title: string;
  overview: string;
  mediaType: 'movie' | 'tv';
  videoLink?: string | null;
  backdropUrl?: string | null;
  posterUrl?: string | null;
  tmdbId?: number | string;
  releaseDate?: string;
  voteAverage?: number;
  genres?: string[];
  logoUrl?: string | null; // NEW: hero logo (TMDB logoUrl from media doc)
};

type VideoPhase = 'preload' | 'playing' | 'finished';

function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

interface HomepageHeroProps {
  item: HeroData;
  onPlay?: (opts: { id?: string | number | null; title?: string }) => void;
}

export function HomepageHero({ item, onPlay }: HomepageHeroProps) {
  const videoId = useMemo(() => getYouTubeId(item.videoLink), [item.videoLink]);
  const [phase, setPhase] = useState<VideoPhase>(videoId ? 'preload' : 'finished');

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

  // Build a MediaItem for WatchlistButton (same as before)
  const mediaItem: MediaItem = {
    id:
      typeof item.tmdbId === 'number'
        ? item.tmdbId
        : Number(item.tmdbId) || 0,
    title: item.title,
    overview: item.overview,
    poster_path: item.posterUrl || '',
    backdrop_path: item.backdropUrl || '',
    release_date: item.releaseDate || '',
    vote_average: item.voteAverage || 0,
    genres: item.genres || [],
    media_type: item.mediaType,
  };

  // 🔑 Use whatever ID we actually have: id OR tmdbId
  const rawDetailId = item.id ?? item.tmdbId;
  const detailId = rawDetailId != null ? String(rawDetailId) : null;

  const detailHref =
    detailId && item.mediaType === 'tv'
      ? `/television/${detailId}`
      : detailId && item.mediaType === 'movie'
      ? `/movies/${detailId}` // adjust if your movie route differs
      : null;

  return (
    <div className="relative aspect-video w-full rounded-xl overflow-hidden">
      {/* Background Media */}
      <div className="absolute inset-0 bg-black">
        {videoId && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&iv_load_policy=3&modestbranding=1`}
            frameBorder="0"
            allow="autoplay; encrypted-media"
            allowFullScreen
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-opacity duration-1000',
              phase === 'playing' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
          />
        )}
        {(item.backdropUrl || item.posterUrl) && (
          <Image
            src={item.backdropUrl || item.posterUrl || ''}
            alt={item.title}
            fill
            className={cn(
              'object-cover transition-opacity duration-1000',
              phase === 'playing' ? 'opacity-0' : 'opacity-100'
            )}
            priority
          />
        )}
      </div>

      {/* Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center p-8">
        <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-4">
          {/* Title / Logo → prefer logo, fall back to text */}
          {detailHref ? (
            <Link
              href={detailHref}
              prefetch={false}
              className="group/headline inline-block"
            >
              {item.logoUrl ? (
                <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-md h-16 sm:h-20 md:h-24">
                  <Image
                    src={item.logoUrl}
                    alt={item.title}
                    fill
                    className="object-contain drop-shadow-2xl"
                  />
                  {/* Accessible text title for screen readers */}
                  <span className="sr-only">{item.title}</span>
                </div>
              ) : (
                <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground drop-shadow-2xl group-hover/headline:text-foreground/90 transition-colors">
                  {item.title}
                </h1>
              )}
            </Link>
          ) : item.logoUrl ? (
            <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-md h-16 sm:h-20 md:h-24">
              <Image
                src={item.logoUrl}
                alt={item.title}
                fill
                className="object-contain drop-shadow-2xl"
              />
              <span className="sr-only">{item.title}</span>
            </div>
          ) : (
            <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground drop-shadow-2xl">
              {item.title}
            </h1>
          )}

          <p className="line-clamp-1 sm:line-clamp-3 md:line-clamp-none text-sm sm:text-base text-foreground/80 leading-relaxed drop-shadow-lg">
            {item.overview}
          </p>

          <div className="hidden sm:flex flex-wrap items-center gap-2">
            {(item.genres || []).map((g) => (
              <Badge key={g} variant="secondary">
                {g}
              </Badge>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="lg"
              className="font-bold"
              onClick={() =>
                onPlay?.({
                  id:
                    typeof item.tmdbId === 'number'
                      ? item.tmdbId
                      : Number(item.tmdbId) || null,
                  title: item.title,
                })
              }
            >
              <Play className="mr-2" />
              Play
            </Button>

            <WatchlistButton
              item={mediaItem}
              variant="secondary"
              className="font-bold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomepageHero;
