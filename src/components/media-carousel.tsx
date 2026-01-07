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
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";

type CardSize = "sm" | "lg";
// 👇 removed "ranked-horizontal"
type Layout = "vertical" | "horizontal" | "featured";

/* =============================================================================
 * Trailer helpers
 * ========================================================================== */

type VideoPhase = "preload" | "playing" | "finished";

function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

/* =============================================================================
 * MediaCarousel props
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
    size?: CardSize;
  };
  getItemHref?: (item: MediaItem) => string | null;
  onPlayItem?: (
    item: MediaItem,
    opts?: { startTime?: number; restart?: boolean }
  ) => void;
  onMarkWatchedItem?: (item: MediaItem) => void;
  layout?: Layout;
  enableProgress?: boolean;
  uid?: string | null;
  hideHeader?: boolean;
}

/** m:ss helper used in horizontal layouts */
function formatTimeShort(sec: number | undefined) {
  if (!sec || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(sec / 60);
  return `${m}:${s}`;
}

/* =============================================================================
 * HorizontalCard (non-ranked)
 * ========================================================================== */

function HorizontalCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  onMarkWatched?: (() => void) | undefined;
  showTitle?: boolean;
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
  const hasResume = typeof resumeSeconds === "number" && resumeSeconds >= 10;
  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));

  const body = (
    <div className="group relative w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-[0.9rem]">
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

        {showTitle && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-2 left-3 right-20 truncate text-sm font-bold text-white drop-shadow">
              {titleText}
            </div>
          </>
        )}

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
                    ? { startTime: resumeSeconds ?? undefined }
                    : undefined
                );
              }}
              className="pointer-events-auto inline-flex h-11 items-center rounded-full bg-black/70 px-4 text-sm font-bold text-white shadow-lg backdrop-blur ring-1 ring-white/20 hover:scale-105 transition-transform"
              aria-label={`${hasResume ? "Resume" : "Play"} ${titleText}`}
            >
              <Play className="h-4 w-4 mr-2" />
              {hasResume
                ? `Resume • ${formatTimeShort(resumeSeconds ?? 0)}`
                : "Play"}
            </button>
          </div>
        )}

        {(onMarkWatched || onPlay) && hasResume && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (onMarkWatched) onMarkWatched();
              else if (onPlay) onPlay({ startTime: 0, restart: true });
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
 * FeaturedCard – hero-style slide
 * ========================================================================== */

function FeaturedCard(props: {
  item: MediaItem;
  href?: string | null;
  onPlay?: ((opts?: { startTime?: number; restart?: boolean }) => void) | undefined;
  onEditMedia?: (() => void) | null;
  progressPercent?: number;
  resumeSeconds?: number | null;
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

  const bg = item.backdrop_path || item.poster_path || "";
  const genres: string[] = Array.isArray((item as any).genres)
    ? ((item as any).genres as string[])
    : [];

  const videoLink = (item as any).videoLink as string | undefined;
  const videoId = React.useMemo(() => getYouTubeId(videoLink), [videoLink]);

  const [phase, setPhase] = React.useState<VideoPhase>(
    videoId && isActive ? "preload" : "finished"
  );

  React.useEffect(() => {
    if (!videoId) {
      setPhase("finished");
      return;
    }
    if (!isActive) {
      setPhase("finished");
      return;
    }
    setPhase("preload");
  }, [videoId, isActive]);

  React.useEffect(() => {
    if (!videoId || !isActive) return;

    if (phase === "preload") {
      const playTimer = setTimeout(() => setPhase("playing"), 6000);
      return () => clearTimeout(playTimer);
    }

    if (phase === "playing") {
      const finishTimer = setTimeout(() => setPhase("finished"), 20000);
      return () => clearTimeout(finishTimer);
    }
  }, [phase, videoId, isActive]);

  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));
  const isTv = item.media_type === "tv";

  const hasResumeFromTime =
    typeof resumeSeconds === "number" &&
    Number.isFinite(resumeSeconds) &&
    resumeSeconds >= 10;

  const hasResumeFromPercent =
    typeof progressPercent === "number" &&
    Number.isFinite(progressPercent) &&
    progressPercent >= 1 &&
    progressPercent < 100;

  const hasResume = hasResumeFromTime || hasResumeFromPercent;
  const showTimeChip = !isTv && hasResumeFromTime;

  const primaryLabel = hasResume
    ? showTimeChip
      ? `Resume • ${formatTimeShort(resumeSeconds ?? 0)}`
      : "Resume"
    : "Watch Now"; 

  const handlePlayClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onPlay) return;
    if (hasResumeFromTime) onPlay({ startTime: resumeSeconds ?? 0 });
    else onPlay(undefined);
  };

  const logo = (item as any).logo_path as string | undefined;

  const Content = (
    <div className="group relative w-full">
      <div className="relative w-full overflow-hidden rounded-[0.9rem] aspect-[4/5] sm:aspect-video">
        <div className="absolute inset-0 bg-black">
          {videoId && isActive && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&iv_load_policy=3&modestbranding=1`}
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
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
                "scale-[1.12] sm:scale-100",
                phase === "playing" && isActive ? "opacity-0" : "opacity-100"
              )}
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 100vw"
            />
          ) : (
            <div className="absolute inset-0 bg-muted" />
          )}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />

        <div className="absolute inset-0 flex items-end justify-center px-4 py-6 sm:items-center sm:justify-start sm:p-8">
          <div className="w-full max-w-md md:max-w-lg lg:max-w-xl space-y-3 sm:space-y-4 text-center sm:text-left">
            {/* Logo Box */}
            <div className="relative mx-auto sm:mx-0 h-16 sm:h-20 md:h-[11rem] w-full max-w-xs sm:max-w-sm md:max-w-md flex items-center justify-center sm:justify-start">
              {logo ? (
                <Image
                  src={logo}
                  alt={item.title}
                  fill
                  className="object-contain object-center sm:object-[left_bottom]"
                  priority={isActive}
                />
              ) : (
                <h3 className="font-headline text-2xl sm:text-3xl md:text-4xl font-bold text-white drop-shadow-2xl leading-tight text-center sm:text-left">
                  {item.title}
                </h3>
              )}
            </div>

            {/* UPDATED OVERVIEW PARAGRAPH */}
            {(item as any).overview ? (
              <p className="line-clamp-2 sm:line-clamp-3 text-sm sm:text-base text-white/80 leading-relaxed drop-shadow-lg">
                {(item as any).overview}
              </p>
            ) : null}

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
                    "w-[55%] sm:w-[55%] max-w-xs mx-auto sm:mx-0",
                    "bg-[#f5f5f5] text-[#2f4f4f]"
                  )}
                >
                  {primaryLabel}
                </button>
              )}
            </div>
          </div>
        </div>

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


/* =============================================================================
 * MediaCarousel – main wrapper
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
  // Normalize artwork
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

  // Progress map
  const progressIds = React.useMemo(
    () => (enableProgress ? normalized.map((i) => String(i.id)) : []),
    [enableProgress, normalized]
  );

  const progressMap = usePlaybackProgress(uid ?? null, progressIds, {
    realtime: false,
  });

  const size: CardSize = cardOverrides?.size ?? "sm";
  const isFeatured = layout === "featured";

  /* ---------------------------------------------------------------------------
   * Default layouts: vertical / horizontal / featured
   * ------------------------------------------------------------------------ */

  const basisClasses = isFeatured
    ? "basis-full"
    : layout === "horizontal"
    ? size === "lg"
      ? "basis-[100%] pl-4 sm:basis-[50%] md:basis-1/3 lg:basis-1/3 xl:basis-1/4 2xl:basis-1/4"
      : "basis-[50%] pl-4 xs:basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6 2xl:basis-1/6"
    : size === "lg"
    ? "basis-1/2 pl-4 sm:basis-1/3 md:basis-1/4 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/5"
    : "basis-1/3 pl-4 sm:basis-1/4 md:basis-1/6 lg:basis-[14.2%] xl:basis-[12.5%] 2xl:basis-[12.5%]";

  const carouselOpts = React.useMemo(
    () => ({
      align: "start" as const,
      loop,
      dragFree: isFeatured ? false : true,
    }),
    [isFeatured, loop]
  );

  // NEW: wheel gestures plugin for horizontal scroll / trackpad
  const plugins = React.useMemo(
    () => [
      WheelGesturesPlugin({
        forceWheelAxis: "x",
        wheelDraggingClass: "is-wheel-dragging",
      }),
    ],
    []
  );

  const carouselClass = cn(
    "w-full",
    !isFeatured && peekNext && "pr-6 -mr-6"
  );
  const contentClass = isFeatured ? "" : "-ml-2";

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
      {/* Header row */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-[1.2rem] font-bold tracking-tight">
            {title}
          </h2>
          {seeAllHref && (
            <Link
              href={seeAllHref}
              className="flex items.center gap-2 text-sm font-medium text-primary hover:text-primary/80"
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
        plugins={plugins}
      >
        <CarouselContent className={contentClass}>
          {normalized.map((item, index) => {
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

            const onMarkWatched =
              onMarkWatchedItem &&
              (() => {
                onMarkWatchedItem(item);
              });

            const href =
              getItemHref?.(item) ??
              (item.media_type === "tv"
                ? `/television/${item.id}`
                : `/movies/${item.id}`);

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