'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

type ShowData = {
  title: string;
  overview: string;
  videoLink?: string | null;
  backdropUrl?: string | null;
  posterUrl?: string | null;
  tmdbShowId?: number;
  firstAirDate?: string;
  voteAverage?: number;
  genres?: string[];
  [key: string]: any;
};

interface ShowHeroProps {
  show: ShowData;
  /** Called when the primary CTA is clicked */
  onPlay?: () => void;
  /** If true, label the CTA as "Resume" instead of "Watch Now" */
  hasResume?: boolean;
}

function getYouTubeId(url: string): string | null {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

type VideoPhase = 'preload' | 'playing' | 'finished';

export function ShowHero({ show, onPlay, hasResume }: ShowHeroProps) {
  const videoId = useMemo(
    () => (show.videoLink ? getYouTubeId(show.videoLink) : null),
    [show.videoLink]
  );

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

  const bg = show.backdropUrl || show.posterUrl || '';
  const buttonLabel = hasResume ? 'Resume' : 'Watch Now';

  return (
    <div className="relative w-full overflow-hidden rounded-xl aspect-[4/5] sm:aspect-video">
      {/* Background media: trailer video + fallback image (hero-style) */}
      <div className="absolute inset-0 bg-black">
        {videoId && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&iv_load_policy=3&modestbranding=1`}
            frameBorder="0"
            allow="autoplay; encrypted-media"
            allowFullScreen
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000',
              // zoomed-in trailer background
              'scale-[2]',
              phase === 'playing'
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            )}
          />
        )}

        {bg && (
          <Image
            src={bg}
            alt={show.title}
            fill
            priority
            className={cn(
              'object-cover transition-opacity duration-1000',
              // zoom on mobile, normal on larger screens
              'scale-[1.12] sm:scale-100',
              phase === 'playing' ? 'opacity-0' : 'opacity-100'
            )}
          />
        )}
      </div>

      {/* Gradient overlay (match featured row) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />

      {/* Content – bottom/center on mobile, left-aligned on larger screens */}
      <div className="absolute inset-0 flex items-end justify-center px-4 py-6 sm:items-center sm:justify-start sm:p-8">
        <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-3 sm:space-y-4 text-center sm:text-left">
          <h1 className="font-headline text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white drop-shadow-2xl">
            {show.title}
          </h1>

          {show.overview && (
            <p className="line-clamp-2 sm:line-clamp-3 text-sm sm:text-base text-white/80 leading-relaxed drop-shadow-lg">
              {show.overview}
            </p>
          )}

          {show.genres && show.genres.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm font-semibold text-white sm:justify-start">
              {show.genres.slice(0, 4).map((genre, idx) => (
                <span key={genre} className="flex items-center gap-1">
                  {idx > 0 && (
                    <span className="opacity-75" aria-hidden="true">
                      •
                    </span>
                  )}
                  <span className="opacity-90">{genre}</span>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 pt-2 sm:justify-start">
            {onPlay && (
              <button
                type="button"
                onClick={() => onPlay()}
                className={cn(
                  'inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-bold shadow-lg transition-opacity',
                  // 55% width on mobile, capped on larger screens
                  'w-[55%] sm:w-[55%] max-w-xs mx-auto sm:mx-0',
                  // Apple TV–style colors
                  'bg-[#f5f5f5] text-[#2f4f4f]'
                )}
              >
                {buttonLabel}
              </button>
            )}
            {/* No Watchlist button here to match the featured layout */}
          </div>
        </div>
      </div>
    </div>
  );
}
