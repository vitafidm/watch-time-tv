
'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

type ShowData = {
  title: string;
  overview: string;
  videoLink?: string | null;
  backdropUrl?: string | null;
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

export function ShowHero({ show }: ShowHeroProps) {
  const videoId = useMemo(() => show.videoLink ? getYouTubeId(show.videoLink) : null, [show.videoLink]);
  const [showVideo, setShowVideo] = useState(!!videoId);

  useEffect(() => {
    if (videoId) {
      const timer = setTimeout(() => {
        setShowVideo(false);
      }, 20000); // 20 seconds
      return () => clearTimeout(timer);
    }
  }, [videoId]);

  return (
    <div className="relative h-screen w-screen -mt-16 -ml-4 sm:-ml-6 -z-10">
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
                    showVideo ? "opacity-100" : "opacity-0 pointer-events-none"
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
                    (videoId && showVideo) ? "opacity-0" : "opacity-100"
                )}
                priority
            />
        )}
      </div>

      {/* Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/30 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center p-4 sm:p-6">
        <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-6">
            <h1 className="font-headline text-5xl md:text-6xl lg:text-7xl font-bold text-foreground drop-shadow-2xl">
                {show.title}
            </h1>
            <p className="text-lg text-foreground/80 line-clamp-3 leading-relaxed drop-shadow-lg">
                {show.overview}
            </p>
            <Button size="lg">
                <Play className="mr-2" />
                Play
            </Button>
        </div>
      </div>
    </div>
  );
}
