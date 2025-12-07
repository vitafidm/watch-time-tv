// src/components/EpisodeSelector.tsx
"use client";

import { useState, useMemo, useEffect } from "react";
import type { MediaDoc } from "@/lib/db.types";
import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play } from "lucide-react";
import Image from "next/image";
import { useAuthUser } from "@/hooks/useAuthUser";
import { callFunction } from "@/lib/api";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";

// --- Types -------------------------------------------------------------------

type EpisodeMeta = {
  season: number;
  episode: number;
  name?: string | null;
  overview?: string | null;
  stillUrl?: string | null;
};

// Episodes can be decorated with resume data
export type EpisodeWithResume = MediaDoc & {
  resumeSeconds?: number;
  /** 0–100 */
  progressPercent?: number;
};

interface EpisodeSelectorProps {
  episodes: EpisodeWithResume[];
  /** TMDB show id (e.g., 12971 for Dragon Ball Z) */
  tmdbShowId?: number | null;
  /** Called when user clicks play/resume on an episode */
  onPlay?: (episode: EpisodeWithResume) => void;
}

// NOTE: keys here must match what tmdbEpisodeDetailsBatch returns.
// From your logs, it returns keys like "S1E1", "S1E2", etc.
function episodeKey(season: number | undefined, episode: number | undefined) {
  if (season == null || episode == null) return "";
  return `S${season}E${episode}`;
}

// --- Episode card with resume UI --------------------------------------------

function EpisodeCard({
  episode,
  meta,
  onClick,
}: {
  episode: EpisodeWithResume;
  meta?: EpisodeMeta;
  onClick?: () => void;
}) {
  const displayTitle = meta?.name || episode.title;
  const displayOverview = meta?.overview || episode.overview || "";
  const stillUrl = meta?.stillUrl || (episode as any).stillUrl || null;

  const rawPercent =
    typeof episode.progressPercent === "number"
      ? episode.progressPercent
      : 0;
  const clampedPercent = Math.max(0, Math.min(rawPercent, 100));

  const hasResume =
    typeof episode.resumeSeconds === "number" && episode.resumeSeconds > 0;

  const showProgressBar =
    typeof episode.progressPercent === "number" &&
    clampedPercent > 0 &&
    clampedPercent < 100;

  return (
    <div className="flex h-full flex-col">
      <Card className="flex flex-grow flex-col overflow-hidden">
        <button
          type="button"
          onClick={onClick}
          className="group relative aspect-video w-full overflow-hidden bg-muted text-left"
        >
          {stillUrl ? (
            <Image
              src={stillUrl}
              alt={`Still from ${displayTitle}`}
              fill
              className="object-cover"
              // Avoid Next.js "fill without sizes" warning
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}

          {/* Hover-only play/resume pill (matches ExtraVideos overlay behavior) */}
          <div
            className="
              pointer-events-none absolute -inset-px flex items-center justify-center
              bg-black/0 opacity-0 transition-all duration-200
              group-hover:bg-black/45 group-hover:opacity-100
            "
          >
            <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm">
              <Play className="h-4 w-4 fill-current" />
              <span>{hasResume ? "Resume" : "Play"}</span>
            </span>
          </div>
        </button>

        <CardContent className="flex flex-grow flex-col p-4">
          <p className="text-sm font-semibold text-primary">
            Episode {episode.episode}
          </p>
          <h3 className="truncate text-lg font-bold leading-tight">
            {displayTitle}
          </h3>

          {/* Progress bar */}
          {showProgressBar && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/40">
              <div
                className="h-full bg-primary"
                style={{ width: `${clampedPercent}%` }}
              />
            </div>
          )}

          {displayOverview && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {displayOverview}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main selector -----------------------------------------------------------

export function EpisodeSelector({
  episodes,
  tmdbShowId,
  onPlay,
}: EpisodeSelectorProps) {
  // Debug helper: make sure resume data is actually coming in
  if (process.env.NODE_ENV !== "production" && episodes.length) {
    // eslint-disable-next-line no-console
    console.log("[EpisodeSelector] sample episode", episodes[0]);
  }

  // ---- Season selection ----
  const seasons = useMemo(() => {
    if (!episodes?.length) return [];
    const seasonSet = new Set<number>();
    episodes.forEach((ep) => {
      if (typeof ep.season === "number") {
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
    return episodes.filter((ep) => ep.season === selectedSeason);
  }, [episodes, selectedSeason]);

  // ---- TMDB episode metadata state ----
  const { user } = useAuthUser();

  const [episodeMeta, setEpisodeMeta] = useState<
    Record<string, EpisodeMeta>
  >({});

  useEffect(() => {
    if (!user || !tmdbShowId || !filteredEpisodes.length) return;

    let cancelled = false;

    (async () => {
      try {
        const idToken = await user.getIdToken();

        const requestEpisodes = filteredEpisodes
          .map((ep) => ({
            season: typeof ep.season === "number" ? ep.season : undefined,
            episode: typeof ep.episode === "number" ? ep.episode : undefined,
          }))
          .filter(
            (e) =>
              typeof e.season === "number" && typeof e.episode === "number"
          ) as { season: number; episode: number }[];

        if (!requestEpisodes.length) return;

        const data = await callFunction<Record<string, EpisodeMeta>>(
          "tmdbEpisodeDetailsBatch",
          {
            tmdbShowId,
            episodes: requestEpisodes,
          },
          idToken
        );

        if (cancelled || !data) return;

        setEpisodeMeta((prev) => ({
          ...prev,
          ...data,
        }));

        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.log(
            "[EpisodeSelector] received TMDB meta keys",
            Object.keys(data)
          );
        }
      } catch (err) {
        console.warn("[EpisodeSelector] tmdbEpisodeDetailsBatch failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, tmdbShowId, filteredEpisodes]);

  if (seasons.length === 0) {
    return null;
  }

  // Carousel opts + wheel gestures (same pattern as MediaCarousel / ExtraVideos)
  const carouselOpts = useMemo(
    () => ({
      align: "start" as const,
      dragFree: true,
    }),
    []
  );

  const plugins = useMemo(
    () => [
      WheelGesturesPlugin({
        forceWheelAxis: "x",
        wheelDraggingClass: "is-wheel-dragging",
      }),
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-3xl font-bold tracking-tight">
          Episodes
        </h2>
        {seasons.length > 1 && (
          <Select
            value={selectedSeason !== null ? String(selectedSeason) : undefined}
            onValueChange={(value) => setSelectedSeason(Number(value))}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select a season" />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((seasonNum) => (
                <SelectItem key={seasonNum} value={String(seasonNum)}>
                  Season {seasonNum}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Carousel
        opts={carouselOpts}
        plugins={plugins}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {filteredEpisodes.map((ep) => {
            const key = episodeKey(
              typeof ep.season === "number" ? ep.season : undefined,
              typeof ep.episode === "number" ? ep.episode : undefined
            );
            const meta = key ? episodeMeta[key] : undefined;

            return (
              <CarouselItem
                key={ep.mediaId ?? `${ep.season}-${ep.episode}`}
                className="basis-full pl-4 sm:basis-1/2 md:basis-1/3 lg:basis-1/4"
              >
                <EpisodeCard
                  episode={ep}
                  meta={meta}
                  onClick={
                    onPlay
                      ? () => {
                          onPlay(ep);
                        }
                      : undefined
                  }
                />
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
    </div>
  );
}

export default EpisodeSelector;
