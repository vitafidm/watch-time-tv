// src/components/media-card.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import type { MediaItem } from "@/lib/types";
import { WatchlistButton } from "./watchlist-button";
import { Play, Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/* =============================================================================
 * Props
 *  - Generic media tile used across rows/collections
 *  - Supports:
 *      • Optional link wrapper
 *      • Hover play/resume overlay
 *      • Progress + resume
 *      • Watchlist or edit controls
 *      • Optional "mark as watched" action
 * ========================================================================== */

interface MediaCardProps {
  item: MediaItem;
  href?: string | null;
  showTitle?: boolean;
  showYear?: boolean;
  showWatchlist?: boolean;
  onPlay?: (opts?: { startTime?: number; restart?: boolean }) => void;
  onEditMedia?: (() => void) | null;

  /** Resume/progress */
  progressPercent?: number;          // 0..100
  resumeSeconds?: number | null;     // if present and >=10, show Resume affordance

  /** Optional explicit restart action (kept for compatibility, not used here) */
  onRestart?: (() => void) | null;

  /** NEW: explicit “mark as watched” action */
  onMarkWatched?: (() => void) | null;
}

/* =============================================================================
 * MediaCard
 * ========================================================================== */

export function MediaCard({
  item,
  href = `/media/${item.id}`,
  showTitle = true,
  showYear = true,
  showWatchlist = true,
  onPlay,
  onEditMedia,
  progressPercent,
  resumeSeconds,
  onRestart,
  onMarkWatched,
}: MediaCardProps) {
  // Normalize poster path (empty → "")
  const poster =
    typeof item.poster_path === "string" ? item.poster_path.trim() : "";

  // Resume is only enabled if we have a meaningful offset
  const hasResume = typeof resumeSeconds === "number" && resumeSeconds >= 10;

  // Clamp progress to [0, 100]
  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));

  // Wrapper: either clickable Link or plain div, but both share the same group classes
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    href ? (
      <Link href={href} className="group block" prefetch={false}>
        {children}
      </Link>
    ) : (
      <div className="group block">{children}</div>
    );

  return (
    <Wrapper>
      <div className="flex flex-col gap-2">
        {/* Poster frame */}
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[0.9rem] shadow-lg bg-muted">
          {poster ? (
            <Image
              src={poster}
              alt={item.title}
              fill
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 60vw, (max-width: 1024px) 30vw, 18vw"
              data-ai-hint={`${item.media_type} poster`}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              No poster
            </div>
          )}

          {/* Hover overlay: darken + Play/Resume CTA + optional "mark as watched" */}
          {onPlay && (
            <div
              className="
                absolute inset-0 z-10 grid place-items-center
                pointer-events-none opacity-0 transition-opacity duration-200
                group-hover:opacity-100 group-focus-within:opacity-100
                will-change-opacity
              "
              aria-hidden="true"
            >
              {/* Dim background */}
              <div className="absolute inset-0 bg-black/45 rounded-lg" />

              {/* Main action = Resume if available; else Play */}
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
                className={cn(
                  "pointer-events-auto inline-flex items-center justify-center",
                  "h-14 rounded-full px-5 bg-black/70 text-white shadow-lg backdrop-blur",
                  "transition-transform hover:scale-105"
                )}
                aria-label={`${hasResume ? "Resume" : "Play"} ${item.title}`}
              >
                <Play className="h-5 w-5 mr-2" aria-hidden="true" />
                <span className="text-sm font-bold">
                  {hasResume ? "Resume" : "Play"}
                </span>
              </button>

              {/* NEW: Mark as watched pill (top-right, only when we have resume AND a handler) */}
              {hasResume && onMarkWatched && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onMarkWatched();
                  }}
                  className="
                    pointer-events-auto absolute top-2 right-2
                    inline-flex items-center gap-1 rounded-full
                    bg-black/70 px-2.5 py-1 text-xs font-semibold text-white
                    shadow-sm ring-1 ring-white/20
                  "
                  title="Mark as watched"
                  aria-label="Mark as watched"
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark as watched
                </button>
              )}
            </div>
          )}

          {/* Top-right control: either edit button OR watchlist icon */}
          {onEditMedia ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEditMedia();
              }}
              className="
                absolute bottom-2 right-2 z-20
                rounded-full bg-black/60 px-2 py-1 text-xs text-white
                opacity-0 transition-opacity duration-200
                group-hover:opacity-100
              "
              aria-label="Edit media"
              title="Edit media"
            >
              ●●●
            </button>
          ) : (
            showWatchlist && (
              <div
                className="
                  absolute right-2 top-2 z-20
                  opacity-0 transition-opacity duration-200
                  group-hover:opacity-100
                "
              >
                <WatchlistButton item={item} asIcon />
              </div>
            )
          )}

          {/* Bottom progress bar (visible when partially watched) */}
          {pct > 0 && pct < 100 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
              <div
                className="h-full bg-white/90"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
            </div>
          )}
        </div>

        {/* Meta: title + year */}
        {showTitle && (
          <div className="space-y-1 px-0.5">
            <h3 className="truncate font-headline text-base font-bold text-foreground">
              {item.title}
            </h3>
            {showYear && item.release_date ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {/* Year derived from ISO date string */}
                <span>{new Date(item.release_date).getFullYear()}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

export default MediaCard;
