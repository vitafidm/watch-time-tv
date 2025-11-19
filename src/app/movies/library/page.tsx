"use client";

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, RefreshCw, Play, Check } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { WatchlistButton } from "@/components/watchlist-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInfiniteFirestore } from "@/hooks/useInfiniteFirestore";
import {
  MediaEditModal,
  type MediaEditModalItem,
} from "@/components/MediaEditModal";
import { PlayerDialog } from "@/components/PlayerDialog";
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress";
import { postPlaybackReport } from "@/lib/playbackReport";

function getInitials(title: string = ""): string {
  return title
    .split(" ")
    .map((word) => word[0])
    .filter((char) => /[a-zA-Z0-9]/.test(char))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function parseYearStr(v?: string | null): number | null {
  if (!v || typeof v !== "string") return null;
  const m = v.match(/(\d{4})/);
  const yr = m ? Number(m[1]) : NaN;
  return Number.isFinite(yr) && yr > 1800 ? yr : null;
}

function getReleaseYear(item: any): number | null {
  // Prefer explicit year fields if present
  if (Number.isFinite(item?.year) && item.year > 1800) return item.year;
  if (Number.isFinite(item?.releaseYear) && item.releaseYear > 1800)
    return item.releaseYear;

  // Common string date fields in your docs (pick what you actually have)
  return (
    parseYearStr(item?.releaseDate) ??
    parseYearStr(item?.theatricalReleaseDate) ??
    parseYearStr(item?.tmdbReleaseDate) ??
    parseYearStr(item?.firstAirDate) ?? // just in case
    null
  );
}

// Poster card for a MediaDoc
function MediaDocCard({
  item,
  onEdit,
  onPlay,
  progressPercent,
  resumeSeconds,
  onMarkWatched,
}: {
  item: MediaDoc & { id: string };
  onEdit: () => void;
  onPlay: (opts?: { startTime?: number; restart?: boolean }) => void;
  progressPercent?: number;
  resumeSeconds?: number | null;
  onMarkWatched?: (() => void) | null;
}) {
  const displayTitle = item.normalizedTitle || item.title;

  const mediaItem = useMemo(() => {
    let releaseDate = new Date().toISOString();
    if (item.addedAt) {
      if (typeof (item.addedAt as any).toDate === "function") {
        releaseDate = (item.addedAt as any).toDate().toISOString();
      } else if (typeof item.addedAt === "string") {
        const d = new Date(item.addedAt);
        if (!isNaN(d.getTime())) releaseDate = d.toISOString();
      }
    }
    return {
      id: item.tmdbId || item.mediaId || item.id,
      title: displayTitle,
      overview: (item as any).overview || "",
      poster_path: item.posterUrl || "",
      backdrop_path:
        item.backdropUrl ||
        `https://picsum.photos/1280/720?random=${item.mediaId}`,
      release_date: releaseDate,
      vote_average: (item as any).vote_average || 0,
      genres: (item as any).genres || [],
      media_type: item.type,
    };
  }, [item, displayTitle]);

  const hasResume =
    typeof resumeSeconds === "number" && resumeSeconds >= 10;
  const pct = Math.max(
    0,
    Math.min(100, Math.floor(progressPercent ?? 0))
  );

  // Small helper: 123s -> “2:03”
  const formatTimeShort = (sec?: number | null) => {
    if (!sec || sec <= 0) return "0:00";
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, "0");
    const m = Math.floor(sec / 60);
    return `${m}:${s}`;
  };

  return (
    <Link
      href={`/movies/${item.id}`}
      prefetch={false}
      className="group block"
      data-testid="movie-card"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 bg-muted">
        {mediaItem.poster_path ? (
          <Image
            src={mediaItem.poster_path}
            alt={mediaItem.title}
            width={500}
            height={750}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            data-ai-hint={`${item.type} poster`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-secondary">
            <span className="font-headline text-4xl text-muted-foreground">
              {getInitials(displayTitle)}
            </span>
          </div>
        )}

        {/* Bottom-right 3-dots edit */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
          className="
            absolute bottom-2 right-2 z-20
            rounded-full bg-black/60 px-2 py-1 text-xs text-white
            opacity-0 transition-opacity duration-200
            backdrop-blur
            group-hover:opacity-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          "
          aria-label="Edit media"
          title="Edit media"
        >
          ●●●
        </button>

        {/* Center overlay + Play / Resume button */}
        <div
          className="
            pointer-events-none absolute inset-0 z-10
            grid place-items-center
            bg-black/0 opacity-0
            transition-opacity duration-200
            group-hover:bg-black/45 group-hover:opacity-100
            group-focus-within:bg-black/45 group-focus-within:opacity-100
          "
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
            className="
              pointer-events-auto inline-flex items-center justify-center
              h-14 rounded-full px-5
              bg-background/60 text-foreground/90
              shadow-lg ring-1 ring-border/50
              transition
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background
              hover:bg-background/80 hover:text-foreground
            "
            aria-label={`${
              hasResume ? "Resume" : "Play"
            } ${displayTitle}`}
          >
            <Play className="h-5 w-5 mr-2" aria-hidden="true" />
            <span className="text-sm font-bold">
              {hasResume
                ? `Resume • ${formatTimeShort(resumeSeconds)}`
                : "Play"}
            </span>
          </button>

          {/* Mark as watched pill (top-right) */}
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

        {/* Bottom progress bar */}
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

      <div className="mt-2 space-y-1">
        <h3
          className="font-headline text-base font-bold text-foreground truncate"
          title={displayTitle}
        >
          {displayTitle}
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{getReleaseYear(item) ?? ""}</span>
        </div>
      </div>
    </Link>
  );
}


function MovieLibrary() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? null;
  const { toast } = useToast();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    items: fetchedMovies,
    loading,
    hasMore,
    attachSentinel,
    resetAndFetch,
    isFetchingNext,
    placeholderCount,
  } = useInfiniteFirestore<MediaDoc & { id: string }>({
    collectionPath: uid ? `users/${uid}/media` : undefined,
    where: [["type", "==", "movie"]],
    orderBy: ["addedAt", "desc"],
    pageSize: 24,
    overscanPx: 1200, // start loading well before the gap
    minRemaining: 6, // tail skeletons
    map: (doc) =>
      ({ id: doc.id, ...doc.data() } as MediaDoc & { id: string }),
  });

  const [movies, setMovies] = useState<Array<MediaDoc & { id: string }>>([]);
  useEffect(() => {
    setMovies(fetchedMovies);
  }, [fetchedMovies]);

  // 🔁 Playback progress (per-movie)
  const progressIds = useMemo(
    () =>
      uid
        ? movies.map((m) => String(m.mediaId || m.id))
        : [],
    [uid, movies]
  );

  const progressMap = usePlaybackProgress(uid, progressIds, {
    realtime: true,
  });

  const [editingItem, setEditingItem] =
    useState<MediaEditModalItem | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(
    null
  );
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(
    undefined
  );
  const [selectedStartTime, setSelectedStartTime] =
    useState<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  attachSentinel(sentinelRef.current);

  const handleEdit = (item: MediaDoc & { id: string }) => {
    if (!uid) return;
    setEditingItem({
      id: item.id,
      collectionPath: `users/${uid}/media`,
      kind: "movie",
      current: {
        title: item.title,
        normalizedTitle: item.normalizedTitle,
        posterUrl: item.posterUrl,
      },
    });
  };

  const handleApplied = (id: string, patch: Partial<MediaDoc>) => {
    setMovies((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  };

  const handleRefresh = async () => {
    if (!resetAndFetch) return;
    setIsRefreshing(true);
    try {
      await resetAndFetch();
      toast({ title: "Library refreshed" });
    } catch (error: any) {
      console.error("Failed to refresh library:", error);
      toast({
        title: "Refresh failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const showInitialLoading = loading && movies.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Film className="h-8 w-8 text-primary" />
          <h1 className="font-headline text-4xl font-bold tracking-tight">
            Movie Library
          </h1>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing || loading}>
          <RefreshCw
            className={`mr-2 h-4 w-4 ${
              isRefreshing ? "animate-spin" : ""
            }`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {showInitialLoading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 lg:grid-cols-5 xl:grid-cols-6 sm:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-lg" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!showInitialLoading && movies.length > 0 && (
        <div
          className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 lg:grid-cols-5 xl:grid-cols-6 sm:grid-cols-3"
          data-testid="movies-grid"
        >
          {movies.map((item) => {
            const playbackKey = String(item.mediaId || item.id);
            const prog = progressMap[playbackKey];
            const progressPercent = prog?.percent ?? 0;
            const resumeSeconds =
              typeof prog?.position === "number" &&
              prog.position >= 10 &&
              progressPercent < 100
                ? prog.position
                : null;

            const onMarkWatched =
              uid && resumeSeconds !== null
                ? async () => {
                    try {
                      const playbackMediaId = item.mediaId || item.id;
                      await postPlaybackReport({
                        mediaId: String(playbackMediaId),
                        position: 0,
                        duration: 1,
                        finished: true,
                      });
                    } catch (e) {
                      console.error(
                        "[playback] mark-as-watched failed",
                        e
                      );
                    }
                  }
                : undefined;

            return (
              <MediaDocCard
                key={item.id}
                item={item}
                onEdit={() => handleEdit(item)}
                progressPercent={progressPercent}
                resumeSeconds={resumeSeconds}
                onMarkWatched={onMarkWatched ?? null}
                onPlay={(opts) => {
                  const playbackMediaId = item.mediaId || item.id;
                  setSelectedMediaId(
                    playbackMediaId ? String(playbackMediaId) : item.id
                  );
                  setSelectedStartTime(
                    typeof opts?.startTime === "number"
                      ? opts.startTime
                      : null
                  );
                  setSelectedTitle(item.title || item.normalizedTitle);
                  setOpen(true);
                }}
              />
            );
          })}

          {/* Tail placeholders for smoothness */}
          {hasMore &&
            Array.from({ length: placeholderCount }).map((_, i) => (
              <div key={`ph-${i}`} className="space-y-2">
                <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
        </div>
      )}

      {!loading && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted py-20 text-center">
          <Film className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-2 font-headline text-2xl text-foreground">
            No Movies Found
          </h2>
          <p className="mt-2 text-muted-foreground">
            Your movie library is empty. Connect an agent to add media.
          </p>
        </div>
      )}

      {hasMore && <div ref={sentinelRef} className="h-10 w-full" />}

      <MediaEditModal
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onApplied={handleApplied}
      />
      <PlayerDialog
        open={open}
        onOpenChange={setOpen}
        mediaId={selectedMediaId}
        title={selectedTitle}
        startTime={selectedStartTime}
      />
    </div>
  );
}

export default function MovieLibraryPage() {
  return (
    <ProtectedRoute>
      <MovieLibrary />
    </ProtectedRoute>
  );
}
