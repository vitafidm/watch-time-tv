// src/components/media-carousel.tsx
"use client";

import type { MediaItem } from "@/lib/types";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import MediaCard from "./media-card";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { WatchlistButton } from "@/components/watchlist-button";
import { Badge } from "@/components/ui/badge";
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress";

type CardSize = "sm" | "lg";
type Layout = "vertical" | "horizontal" | "featured";

interface MediaCarouselProps {
  title: string;
  items: MediaItem[];
  seeAllHref?: string;
  peekNext?: boolean;
  showArrows?: boolean;
  loop?: boolean;
  onEditMedia?: ((item: MediaItem) => void) | null;
  cardOverrides?: {
    showYear?: boolean;
    showWatchlist?: boolean;
    showTitle?: boolean;
    size?: CardSize; // vertical & horizontal
  };
  getItemHref?: (item: MediaItem) => string | null;

  // onPlay can receive a startTime/restart flag
  onPlayItem?: (item: MediaItem, opts?: { startTime?: number; restart?: boolean }) => void;

  layout?: Layout;

  // per-card progress via /users/{uid}/playback/{mediaId}
  enableProgress?: boolean;
  uid?: string | null;
}

/** Small helper */
function formatTimeShort(sec: number | undefined) {
  if (!sec || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(sec / 60);
  return `${m}:${s}`;
}

/** Horizontal (16:9) with progress + resume */
function HorizontalCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  showTitle?: boolean;

  // progress
  progressPercent?: number;
  resumeSeconds?: number | null;
}) {
  const { item, href, onPlay, onEditMedia, showTitle = true, progressPercent, resumeSeconds } =
    props;

  const img = item.backdrop_path || "";
  const titleText = item.title;
  const hasResume = typeof resumeSeconds === "number" && resumeSeconds >= 10;
  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));

  const body = (
    <div className="group relative w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl">
        {img ? (
          <Image
            src={img}
            alt={titleText}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 80vw, (max-width: 1024px) 40vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}

        {/* Title gradient + bold title */}
        {showTitle && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-2 left-3 right-20 truncate text-sm font-bold text-white drop-shadow">
              {titleText}
            </div>
          </>
        )}

        {/* Center action: Resume (if available) or Play */}
        {onPlay && (
          <div
            className={cn(
              "absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200",
              "pointer-events-none group-hover:opacity-100"
            )}
            aria-hidden="true"
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPlay(
                  hasResume
                    ? {
                        startTime: resumeSeconds ?? undefined,
                      }
                    : undefined
                );
              }}
              className="pointer-events-auto inline-flex h-11 items-center rounded-full bg-black/70 px-4 text-sm font-bold text-white shadow-lg backdrop-blur ring-1 ring-white/20 hover:scale-105 transition-transform"
              aria-label={`${hasResume ? "Resume" : "Play"} ${titleText}`}
            >
              <Play className="h-4 w-4 mr-2" />
              {hasResume ? `Resume • ${formatTimeShort(resumeSeconds ?? 0)}` : "Play"}
            </button>

            {/* Horizontal cards still keep Restart */}
            {hasResume && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlay({ startTime: 0, restart: true });
                }}
                className="pointer-events-auto absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white shadow-sm ring-1 ring-white/10"
                title="Restart from beginning"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restart
              </button>
            )}
          </div>
        )}

        {/* Edit dots */}
        {onEditMedia && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditMedia();
            }}
            className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            ●●●
          </button>
        )}

        {/* Bottom progress bar */}
        {pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
            <div className="h-full bg-white/90" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block" prefetch={false}>
      {body}
    </Link>
  ) : (
    body
  );
}

/** Featured card: hero-like (no Restart), Resume for movies & TV */
function FeaturedCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  progressPercent?: number;
  resumeSeconds?: number | null;
}) {
  const { item, href, onPlay, onEditMedia, progressPercent, resumeSeconds } = props;

  const bg = item.backdrop_path || item.poster_path || "";
  const genres: string[] = Array.isArray((item as any).genres)
    ? ((item as any).genres as string[])
    : [];

  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));

  const isTv = item.media_type === "tv";

  // --- Resume detection (from playback docs) ---
  const hasResumeFromTime =
    typeof resumeSeconds === "number" && Number.isFinite(resumeSeconds) && resumeSeconds >= 10;

  const hasResumeFromPercent =
    typeof progressPercent === "number" &&
    Number.isFinite(progressPercent) &&
    progressPercent >= 1 &&
    progressPercent < 100;

  // If we have playback progress, that's a true "resume".
  const hasResume = hasResumeFromTime || hasResumeFromPercent;

  // For movies we safely show time; for TV we omit the timestamp (show just "Resume").
  const showTimeChip = !isTv && hasResumeFromTime;

  const primaryLabel = hasResume
    ? showTimeChip
      ? `Resume • ${formatTimeShort(resumeSeconds ?? 0)}`
      : "Resume"
    : isTv
    ? "Resume" // Fallback label for TV: UX says "Resume", actual start logic is still handled in the parent
    : "Play";

  const handlePlayClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onPlay) return;

    // If we know the resume time, pass it down; otherwise let the parent logic decide
    if (hasResumeFromTime) {
      onPlay({ startTime: resumeSeconds ?? 0 });
    } else {
      onPlay(undefined);
    }
  };

  const Content = (
    <div className="group relative w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl">
        {bg ? (
          <Image
            src={bg}
            alt={item.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 90vw, (max-width: 1280px) 80vw, 100vw"
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}

        {/* Hero-style gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

        {/* Content */}
        <div className="absolute inset-0 flex items-center p-6 sm:p-8">
          <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-3 sm:space-y-4">
            <h3 className="font-headline text-2xl sm:text-3xl md:text-4xl font-bold text-foreground drop-shadow-2xl">
              {item.title}
            </h3>

            {(item as any).overview ? (
              <p className="line-clamp-2 sm:line-clamp-3 text-sm sm:text-base text-foreground/80 leading-relaxed drop-shadow-lg">
                {(item as any).overview}
              </p>
            ) : null}

            {genres.length > 0 && (
              <div className="hidden sm:flex flex-wrap items-center gap-2">
                {genres.slice(0, 6).map((g) => (
                  <Badge key={g} variant="secondary">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {onPlay && (
                <button
                  type="button"
                  onClick={handlePlayClick}
                  className="inline-flex h-10 sm:h-11 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground shadow hover:opacity-95"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {primaryLabel}
                </button>
              )}

              <WatchlistButton
                item={item}
                variant="secondary"
                className="font-bold h-10 sm:h-11"
              />
            </div>
          </div>
        </div>

        {/* Bottom progress bar */}
        {pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
            <div className="h-full bg-white/90" style={{ width: `${pct}%` }} />
          </div>
        )}

        {onEditMedia && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditMedia();
            }}
            className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            ●●●
          </button>
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block" prefetch={false}>
      {Content}
    </Link>
  ) : (
    Content
  );
}

export function MediaCarousel({
  title,
  items,
  seeAllHref,
  peekNext = false,
  showArrows = true,
  loop = false,
  onEditMedia = null,
  cardOverrides,
  getItemHref,
  onPlayItem,
  layout = "vertical",
  enableProgress = false,
  uid = null,
}: MediaCarouselProps) {
  // Normalize paths
  const normalized = React.useMemo(
    () =>
      items.map((it) => ({
        ...it,
        poster_path:
          typeof it.poster_path === "string" && it.poster_path.trim().length > 0
            ? it.poster_path
            : undefined,
        backdrop_path:
          typeof (it as any).backdrop_path === "string" &&
          (it as any).backdrop_path.trim().length > 0
            ? (it as any).backdrop_path
            : undefined,
      })),
    [items]
  );

  // Attach live playback progress if enabled
  const progressIds = React.useMemo(
    () => (enableProgress ? normalized.map((i) => String(i.id)) : []),
    [enableProgress, normalized]
  );

  const progressMap = usePlaybackProgress(uid ?? null, progressIds, {
    realtime: false, // homepage bars don’t need realtime
  });

  const size: CardSize = cardOverrides?.size ?? "sm";
  const isFeatured = layout === "featured";

  const basisClasses = isFeatured
    ? "basis-full"
    : layout === "horizontal"
    ? size === "lg"
      ? "basis-[85%] pl-4 sm:basis-[60%] md:basis-1/2 lg:basis-2/5 xl:basis-1/3 2xl:basis-1/4"
      : "basis-[70%] pl-4 sm:basis-[50%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
    : size === "lg"
    ? "basis-2/3 pl-4 sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4 2xl:basis-1/5"
    : "basis-1/2 pl-4 sm:basis-1/4 md:basis-1/5 lg:basis-1/6 xl:basis-1/7 2xl:basis-[12.5%]";

  const carouselOpts = React.useMemo(
    () => ({ align: "start" as const, loop, dragFree: isFeatured ? false : true }),
    [isFeatured, loop]
  );

  const carouselClass = cn("w-full", !isFeatured && peekNext && "pr-6 -mr-6");
  const contentClass = isFeatured ? "" : "-ml-2";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-3xl font-bold tracking-tight">{title}</h2>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
          >
            See All <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <Carousel opts={carouselOpts} className={carouselClass}>
        <CarouselContent className={contentClass}>
          {normalized.map((item) => {
            const prog = progressMap[String(item.id)];
            const progressPercent = prog?.percent ?? 0;
            const resumeSeconds =
              prog && prog.percent >= 1 && prog.percent < 100
                ? prog.position ?? null
                : null;

            const onPlay =
              onPlayItem &&
              ((opts?: { startTime?: number; restart?: boolean }) =>
                onPlayItem(item, opts));

            const href =
              getItemHref?.(item) ??
              (item.media_type === "tv"
                ? `/television/${item.id}`
                : `/movies/${item.id}`);

            return (
              <CarouselItem key={item.id} className={basisClasses}>
                {isFeatured ? (
                  <FeaturedCard
                    item={item}
                    href={href}
                    onPlay={onPlay}
                    onEditMedia={onEditMedia ? () => onEditMedia(item) : null}
                    progressPercent={progressPercent}
                    resumeSeconds={resumeSeconds}
                  />
                ) : layout === "horizontal" ? (
                  <HorizontalCard
                    item={item}
                    href={href}
                    onPlay={onPlay}
                    onEditMedia={onEditMedia ? () => onEditMedia(item) : null}
                    showTitle={
                      cardOverrides?.showTitle !== undefined
                        ? cardOverrides.showTitle
                        : true
                    }
                    progressPercent={progressPercent}
                    resumeSeconds={resumeSeconds}
                  />
                ) : (
                  <MediaCard
                    item={item}
                    href={href}
                    onPlay={onPlay}
                    onEditMedia={onEditMedia ? () => onEditMedia(item) : null}
                    showTitle={
                      cardOverrides?.showTitle !== undefined
                        ? cardOverrides.showTitle
                        : true
                    }
                    showYear={
                      cardOverrides?.showYear !== undefined
                        ? cardOverrides.showYear
                        : true
                    }
                    showWatchlist={
                      cardOverrides?.showWatchlist !== undefined
                        ? cardOverrides.showWatchlist
                        : true
                    }
                    progressPercent={progressPercent}
                    resumeSeconds={resumeSeconds}
                  />
                )}
              </CarouselItem>
            );
          })}
        </CarouselContent>

        {showArrows && (
          <>
            <CarouselPrevious className="hidden md:flex" />
            <CarouselNext className="hidden md:flex" />
          </>
        )}
      </Carousel>
    </div>
  );
}

export default MediaCarousel;
