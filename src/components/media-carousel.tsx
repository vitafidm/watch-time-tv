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
import { ArrowRight, Play, Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress";

type CardSize = "sm" | "lg";
type Layout = "vertical" | "horizontal" | "featured";

/* =============================================================================
 * Trailer helpers (same logic as HomepageHero)
 *  - Shared YouTube ID parsing + simple phase state for hero trailers
 * ========================================================================== */

type VideoPhase = "preload" | "playing" | "finished";

// Extract a YouTube video ID from a variety of URL formats
function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

/* =============================================================================
 * MediaCarousel props
 *  - Generic carousels used across home, collections, etc.
 *  - Supports multiple layouts + custom navigation + progress
 * ========================================================================== */

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

  // called when the user hits "Mark as watched" on a card
  onMarkWatchedItem?: (item: MediaItem) => void;

  layout?: Layout;

  // per-card progress via /users/{uid}/playback/{mediaId}
  enableProgress?: boolean;
  uid?: string | null;

  // Hide the carousel header (title + See All)
  hideHeader?: boolean;
}

/** Small helper: format seconds as m:ss for resume chips */
function formatTimeShort(sec: number | undefined) {
  if (!sec || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(sec / 60);
  return `${m}:${s}`;
}

/* =============================================================================
 * HorizontalCard
 *  - 16:9 tile with hover play/resume, progress bar, mark-as-watched, and edit dots
 * ========================================================================== */

/** Horizontal (16:9) with progress + resume */
function HorizontalCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  onMarkWatched?: (() => void) | undefined;
  showTitle?: boolean;

  // progress
  progressPercent?: number;
  resumeSeconds?: number | null;
}) {
  const {
    item,
    href,
    onPlay,
    onEditMedia,
    onMarkWatched,
    showTitle = true,
    progressPercent,
    resumeSeconds,
  } = props;

  const img = item.backdrop_path || "";
  const titleText = item.title;

  // Resume is only enabled if we have a meaningful position (>= 10s)
  const hasResume = typeof resumeSeconds === "number" && resumeSeconds >= 10;

  // Clamp progress to [0, 100]
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
          </div>
        )}

        {/* Mark as Watched chip (top-right).
            - If `onMarkWatched` exists, we call it
            - Otherwise we restart playback from 0 */}
        {(onMarkWatched || onPlay) && hasResume && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (onMarkWatched) {
                onMarkWatched();
              } else if (onPlay) {
                onPlay({ startTime: 0, restart: true });
              }
            }}
            className={cn(
              "pointer-events-auto absolute top-2 right-2",
              "inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5",
              "text-xs font-semibold text-white shadow-sm ring-1 ring-white/20",
              "opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            )}
            title="Mark as watched"
          >
            <Check className="h-3.5 w-3.5" />
            Mark as watched
          </button>
        )}

        {/* Edit dots for quick metadata edits on the card */}
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

        {/* Bottom progress bar (only show when partially watched) */}
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

/* =============================================================================
 * FeaturedCard
 *  - Hero-style slide:
 *      • Supports auto-playing trailer
 *      • Shows overview + genres
 *      • Uses progress for resume bar
 * ========================================================================== */

/** Featured card: hero-like (no Restart), Resume for movies & TV + trailer support */
function FeaturedCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  progressPercent?: number;
  resumeSeconds?: number | null;
  // Only play trailer when this slide is the active one
  isActive?: boolean;
}) {
  const {
    item,
    href,
    onPlay,
    onEditMedia,
    progressPercent,
    resumeSeconds,
    isActive = false,
  } = props;

  // Prefer backdrop but fall back to poster
  const bg = item.backdrop_path || item.poster_path || "";
  const genres: string[] = Array.isArray((item as any).genres)
    ? ((item as any).genres as string[])
    : [];

  // --- Trailer wiring (from HomepageHero) ---------------------------------
  const videoLink = (item as any).videoLink as string | undefined;
  const videoId = React.useMemo(() => getYouTubeId(videoLink), [videoLink]);

  // Simple phase machine for hero video
  const [phase, setPhase] = React.useState<VideoPhase>(
    videoId && isActive ? "preload" : "finished"
  );

  // When the slide becomes active/inactive, restart or stop the trailer cycle
  React.useEffect(() => {
    if (!videoId) {
      setPhase("finished");
      return;
    }

    if (!isActive) {
      // If this slide is no longer active, force background image only
      setPhase("finished");
      return;
    }

    // When it becomes active, restart the preload → play sequence
    setPhase("preload");
  }, [videoId, isActive]);

  // Timers only run while this slide is active
  React.useEffect(() => {
    if (!videoId || !isActive) return;

    if (phase === "preload") {
      // Delay before fading in the trailer
      const playTimer = setTimeout(() => setPhase("playing"), 6000);
      return () => clearTimeout(playTimer);
    }

    if (phase === "playing") {
      // After some time, fall back to static artwork
      const finishTimer = setTimeout(() => setPhase("finished"), 20000);
      return () => clearTimeout(finishTimer);
    }
  }, [phase, videoId, isActive]);

  // Clamp progress
  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));
  const isTv = item.media_type === "tv";

  // --- Resume detection (from playback docs) ---
  const hasResumeFromTime =
    typeof resumeSeconds === "number" &&
    Number.isFinite(resumeSeconds) &&
    resumeSeconds >= 10;

  const hasResumeFromPercent =
    typeof progressPercent === "number" &&
    Number.isFinite(progressPercent) &&
    progressPercent >= 1 &&
    progressPercent < 100;

  // If we have playback progress, that's a true "resume".
  const hasResume = hasResumeFromTime || hasResumeFromPercent;

  // For movies we safely show time; for TV we omit the timestamp (show just "Resume").
  const showTimeChip = !isTv && hasResumeFromTime;

  // Primary CTA label (kept for reference; button text below is currently hardcoded)
  const primaryLabel = hasResume
    ? showTimeChip
      ? `Resume • ${formatTimeShort(resumeSeconds ?? 0)}`
      : "Resume"
    : isTv
    ? "Resume"
    : "Watch Now"; // label is overridden below anyway

  const handlePlayClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onPlay) return;

    if (hasResumeFromTime) {
      onPlay({ startTime: resumeSeconds ?? 0 });
    } else {
      onPlay(undefined);
    }
  };

  const Content = (
    <div className="group relative w-full">
      {/* NOTE: taller aspect on mobile, regular 16:9 on desktop */}
      <div className="relative w-full overflow-hidden rounded-xl aspect-[4/5] sm:aspect-video">
        {/* Background media: trailer video + fallback image (hero-style) */}
        <div className="absolute inset-0 bg-black">
          {videoId && isActive && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&iv_load_policy=3&modestbranding=1`}
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
                // slight zoom on mobile, normal on larger screens
                "scale-[2]",
                phase === "playing"
                  ? "opacity-100"
                  : "opacity-0 pointer-events-none"
              )}
            />
          )}

          {bg ? (
            <Image
              src={bg}
              alt={item.title}
              fill
              className={cn(
                "object-cover transition-opacity duration-1000",
                // slight zoom on mobile, normal on larger screens
                "scale-[1.12] sm:scale-100",
                phase === "playing" && isActive ? "opacity-0" : "opacity-100"
              )}
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 100vw"
            />
          ) : (
            <div className="absolute inset-0 bg-muted" />
          )}
        </div>

        {/* Hero-style gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent" /> 
        {/* <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />*/}

        {/* Content */}
        <div className="absolute inset-0 flex items-end justify-center px-4 py-6 sm:items-center sm:justify-start sm:p-8">
          <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-3 sm:space-y-4 text-center sm:text-left">
            <h3 className="font-headline text-2xl sm:text-3xl md:text-4xl font-bold text-white drop-shadow-2xl">
              {item.title}
            </h3>

            {/* Optional overview – keep for desktop, hide on small to match Apple TV vibe */}
            {(item as any).overview ? (
              <p className="sm:block line-clamp-2 sm:line-clamp-3 text-sm sm:text-base text-white/80 leading-relaxed drop-shadow-lg">
                {(item as any).overview}
              </p>
            ) : null}

            {/* Compact genre row */}
            {genres.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm font-semibold text-white sm:justify-start">
                {genres.slice(0, 4).map((g, idx) => (
                  <React.Fragment key={g}>
                    {idx > 0 && (
                      <span className="opacity-75" aria-hidden="true">
                        •
                      </span>
                    )}
                    <span className="opacity-90">{g}</span>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2 sm:justify-start">
              {onPlay && (
                <button
                  type="button"
                  onClick={handlePlayClick}
                  className={cn(
                    "inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-bold shadow-lg transition-opacity",
                    // 55% width on mobile, auto on larger screens
                    "w-[55%] sm:w-[55%] max-w-xs mx-auto sm:mx-0",
                    // custom Apple-TV-style colors
                    "bg-[#f5f5f5] text-[#2f4f4f]"
                  )}
                >
                  Watch Now
                </button>
              )}
              {/* No Watchlist button in featured layout */}
            </div>
          </div>
        </div>

        {/* Bottom progress bar */}
        {pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
            <div
              className="h-full bg-white/90"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Edit affordance in hero */}
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

/* =============================================================================
 * MediaCarousel
 *  - Main carousel wrapper around MediaCard/HorizontalCard/FeaturedCard
 *  - Handles:
 *      • Progress hookup (usePlaybackProgress)
 *      • Layout sizing & Embla options
 *      • See All header + navigation arrows
 * ========================================================================== */

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
  onMarkWatchedItem,
  layout = "vertical",
  enableProgress = false,
  uid = null,
  hideHeader = false,
}: MediaCarouselProps) {
  // Normalize image paths (empty strings → undefined) to keep <Image> happy
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

  // Map of mediaId → { percent, position, ... }
  const progressMap = usePlaybackProgress(uid ?? null, progressIds, {
    realtime: false,
  });

  const size: CardSize = cardOverrides?.size ?? "sm";
  const isFeatured = layout === "featured";

  // Per-layout basis widths for carousel items (responsive)
  const basisClasses = isFeatured
    ? "basis-full"
    : layout === "horizontal"
    ? size === "lg"
      ? "basis-[85%] pl-4 sm:basis-[60%] md:basis-1/2 lg:basis-2/5 xl:basis-1/3 2xl:basis-1/4"
      : "basis-[70%] pl-4 sm:basis-[50%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
    : size === "lg"
    ? "basis-2/3 pl-4 sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4 2xl:basis-1/5"
    : "basis-1/2 pl-4 sm:basis-1/4 md:basis-1/5 lg:basis-1/6 xl:basis-1/7 2xl:basis-[12.5%]";

  // Embla carousel options (dragFree disabled for featured hero)
  const carouselOpts = React.useMemo(
    () => ({ align: "start" as const, loop, dragFree: isFeatured ? false : true }),
    [isFeatured, loop]
  );

  const carouselClass = cn("w-full", !isFeatured && peekNext && "pr-6 -mr-6");
  const contentClass = isFeatured ? "" : "-ml-2";

  // Embla instance + active index (used for featured trailer activation)
  const [emblaApi, setEmblaApi] = React.useState<any | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      const snapIndex = emblaApi.selectedScrollSnap();
      setActiveIndex(snapIndex);
    };

    onSelect();
    emblaApi.on("select", onSelect);

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  return (
    <div className="space-y-4">
      {/* Header row: title + optional "See All" link */}
      {!hideHeader && (
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
      )}

      <Carousel
        opts={carouselOpts}
        className={carouselClass}
        setApi={setEmblaApi}
      >
        <CarouselContent className={contentClass}>
          {normalized.map((item, index) => {
            const prog = progressMap[String(item.id)];
            const progressPercent = prog?.percent ?? 0;

            // Only treat as resumable if we have partial progress (1–99%)
            const resumeSeconds =
              prog && prog.percent >= 1 && prog.percent < 100
                ? prog.position ?? null
                : null;

            // Wrap onPlayItem so callers don't have to know about MediaItem
            const onPlay =
              onPlayItem &&
              ((opts?: { startTime?: number; restart?: boolean }) =>
                onPlayItem(item, opts));

            const onMarkWatched =
              onMarkWatchedItem &&
              (() => {
                onMarkWatchedItem(item);
              });

            // Default route if caller didn't provide getItemHref
            const href =
              getItemHref?.(item) ??
              (item.media_type === "tv"
                ? `/television/${item.id}`
                : `/movies/${item.id}`);

            // For featured layout, track if this slide is currently active
            const isActiveSlide = isFeatured ? index === activeIndex : false;

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
                    isActive={isActiveSlide}
                  />
                ) : layout === "horizontal" ? (
                  <HorizontalCard
                    item={item}
                    href={href}
                    onPlay={onPlay}
                    onEditMedia={onEditMedia ? () => onEditMedia(item) : null}
                    onMarkWatched={onMarkWatched}
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
