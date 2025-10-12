
'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaItem } from '@/lib/types';
import { WatchlistButton } from '@/components/watchlist-button';

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
}

function getYouTubeId(url: string): string | null {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

type VideoPhase = 'preload' | 'playing' | 'finished';

export function ShowHero({ show }: ShowHeroProps) {
  const videoId = useMemo(() => show.videoLink ? getYouTubeId(show.videoLink) : null, [show.videoLink]);
  const [phase, setPhase] = useState<VideoPhase>(videoId ? 'preload' : 'finished');

  useEffect(() => {
    if (!videoId) return;

    if (phase === 'preload') {
      const playTimer = setTimeout(() => {
        setPhase('playing');
      }, 6000); // 6-second preload
      
      return () => clearTimeout(playTimer);
    }
    
    if (phase === 'playing') {
      const finishTimer = setTimeout(() => {
        setPhase('finished');
      }, 20000); // 20-second video play
      
      return () => clearTimeout(finishTimer);
    }
  }, [phase, videoId]);

  const mediaItem: MediaItem = {
      id: show.tmdbShowId || 0,
      title: show.title,
      overview: show.overview,
      poster_path: show.posterUrl || '',
      backdrop_path: show.backdropUrl || '',
      release_date: show.firstAirDate || '',
      vote_average: show.voteAverage || 0,
      genres: show.genres || [],
      media_type: 'tv',
  };

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
                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-1000",
                    phase === 'playing' ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
            />
        )}
        {show.backdropUrl && (
             <Image
                src={show.backdropUrl}
                alt={show.title}
                fill
                className={cn(
                    "object-cover transition-opacity duration-1000",
                     phase === 'playing' ? "opacity-0" : "opacity-100"
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
            <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground drop-shadow-2xl">
                {show.title}
            </h1>
            <p className="line-clamp-1 sm:line-clamp-3 md:line-clamp-none text-sm sm:text-base text-foreground/80 leading-relaxed drop-shadow-lg">
                {show.overview}
            </p>
            <div className="hidden sm:flex flex-wrap items-center gap-2">
              {(show.genres || []).map(genre => (
                <Badge key={genre} variant="secondary">{genre}</Badge>
              ))}
            </div>
            <div className="flex items-center gap-2">
                <Button size="lg" className="font-bold">
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
