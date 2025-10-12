
'use client';

import { useState, useMemo } from 'react';
import type { MediaDoc } from '@/lib/db.types';
import { Card, CardContent } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import Image from 'next/image';

interface EpisodeSelectorProps {
  episodes: MediaDoc[];
}

function EpisodeCard({ episode }: { episode: MediaDoc }) {
  return (
    <div className="flex flex-col h-full">
      <Card className="flex-grow flex flex-col overflow-hidden">
        <div className="relative aspect-video w-full bg-muted">
          {episode.stillUrl ? (
             <Image
              src={episode.stillUrl}
              alt={`Still from ${episode.title}`}
              fill
              className="object-cover"
            />
          ) : (
             <div className="w-full h-full bg-muted" />
          )}
          <Button size="icon" variant="ghost" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70">
            <Play className="h-6 w-6 fill-current" />
          </Button>
        </div>
        <CardContent className="p-4 flex-grow">
          <p className="text-sm font-semibold text-primary">
            Episode {episode.episode}
          </p>
          <h3 className="font-bold text-lg leading-tight truncate">
            {episode.title}
          </h3>
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {episode.overview}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function EpisodeSelector({ episodes }: EpisodeSelectorProps) {
  const seasons = useMemo(() => {
    if (!episodes) return [];
    const seasonSet = new Set<number>();
    episodes.forEach(ep => {
      if (typeof ep.season === 'number') {
        seasonSet.add(ep.season);
      }
    });
    return Array.from(seasonSet).sort((a, b) => a - b);
  }, [episodes]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    seasons.length > 0 ? seasons[0] : null
  );

  const filteredEpisodes = useMemo(() => {
    if (selectedSeason === null) return [];
    return episodes.filter(ep => ep.season === selectedSeason);
  }, [episodes, selectedSeason]);

  if (seasons.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-3xl font-bold tracking-tight">Episodes</h2>
        {seasons.length > 1 && (
          <Select
            value={String(selectedSeason)}
            onValueChange={(value) => setSelectedSeason(Number(value))}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select a season" />
            </SelectTrigger>
            <SelectContent>
              {seasons.map(seasonNum => (
                <SelectItem key={seasonNum} value={String(seasonNum)}>
                  Season {seasonNum}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Carousel
        opts={{
          align: 'start',
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {filteredEpisodes.map((ep) => (
            <CarouselItem key={ep.mediaId} className="pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4">
              <EpisodeCard episode={ep} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
