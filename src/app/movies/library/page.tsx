"use client";

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, RefreshCw, Play, Check } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  MediaEditModal,
  type MediaEditModalItem,
} from "@/components/MediaEditModal";
import { PlayerDialog } from "@/components/PlayerDialog";
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress";
import { postPlaybackReport } from "@/lib/playbackReport";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

/* -----------------------------------------------------------------------------
 * Types & cache
 * -------------------------------------------------------------------------- */

type MovieWithId = MediaDoc & { id: string };

type MoviesCache = {
  uid: string;
  movies: MovieWithId[];
  ts: number;
};

let moviesCache: MoviesCache | null = null;
const MOVIES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* -----------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

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
  if (Number.isFinite(item?.year) && item.year > 1800) return item.year;
  if (Number.isFinite(item?.releaseYear) && item.releaseYear > 1800)
    return item.releaseYear;

  return (
    parseYearStr(item?.releaseDate) ??
    parseYearStr(item?.theatricalReleaseDate) ??
    parseYearStr(item?.tmdbReleaseDate) ??
    parseYearStr(item?.firstAirDate) ??
    null
  );
}

function getDisplayTitle(item: MovieWithId): string {
  const anyItem = item as any;
  return (
    anyItem.displayTitle ||          // canon from TMDB / Fix Match
    item.normalizedTitle ||          // cleaned-up ingest title
    item.title ||                    // raw title from ingest
    anyItem.filename ||              // last resort: filename
    "Unknown Title"
  );
}


function sortMoviesAlpha(list: MovieWithId[]): MovieWithId[] {
  return [...list].sort((a, b) => {
    const nameA = (a.normalizedTitle || a.title || "").toLocaleLowerCase();
    const nameB = (b.normalizedTitle || b.title || "").toLocaleLowerCase();
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });
}

/* -----------------------------------------------------------------------------
 * Poster card
 * -------------------------------------------------------------------------- */

function MediaDocCard({
  item,
  onEdit,
  onPlay,
  progressPercent,
  resumeSeconds,
  onMarkWatched,
}: {
  item: MovieWithId;
  onEdit: () => void;
  onPlay: (opts?: { startTime?: number; restart?: boolean }) => void;
  progressPercent?: number;
  resumeSeconds?: number | null;
  onMarkWatched?: (() => void) | null;
}) {
  const displayTitle = getDisplayTitle(item);

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

/* -----------------------------------------------------------------------------
 * Movie Library
 * -------------------------------------------------------------------------- */

function MovieLibrary() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? null;
  const { toast } = useToast();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [movies, setMovies] = useState<MovieWithId[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingItem, setEditingItem] =
    useState<MediaEditModalItem | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(
    undefined
  );
  const [selectedStartTime, setSelectedStartTime] =
    useState<number | null>(null);

  // 🔁 Fetch all movies once, with per-uid cache
  const fetchMovies = useCallback(
    async (opts?: { forceNetwork?: boolean }) => {
      if (!uid) return;
      const forceNetwork = opts?.forceNetwork ?? false;
      const now = Date.now();

      if (
        !forceNetwork &&
        moviesCache &&
        moviesCache.uid === uid &&
        now - moviesCache.ts < MOVIES_CACHE_TTL_MS
      ) {
        setMovies(moviesCache.movies);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const ref = collection(db, "users", uid, "media");
        const q = query(ref, where("type", "==", "movie"));
        const snap = await getDocs(q);

        const all: MovieWithId[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as MediaDoc;
          return { id: docSnap.id, ...data };
        });

        const sorted = sortMoviesAlpha(all);
        setMovies(sorted);

        moviesCache = {
          uid,
          movies: sorted,
          ts: Date.now(),
        };
      } catch (error) {
        console.error("Failed to load movie library:", error);
        toast({
          title: "Failed to load movie library",
          description:
            error instanceof Error ? error.message : "Unknown error occurred",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [uid, toast]
  );

  // Initial load
  useEffect(() => {
    void fetchMovies();
  }, [fetchMovies]);

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

  const handleEdit = (item: MovieWithId) => {
    if (!uid) return;

    const year = getReleaseYear(item) ?? undefined;
    const logoUrl = (item as any).logoUrl ?? null;
    const videoLink = (item as any).videoLink ?? null;
    const tmdbId = (item as any).tmdbId ?? undefined;
    const filename = (item as any).filename ?? null;
    const displayTitle =
       (item as any).displayTitle ||
       item.normalizedTitle ||
       item.title ||
       (item as any).filename ||
       "";


    setEditingItem({
      id: item.id,
      collectionPath: `users/${uid}/media`,
      kind: "movie",
      current: {
        // Titles
        title: item.title,
        normalizedTitle: item.normalizedTitle,
        displayTitle,
        year,
        filename,
        // Artwork
        posterUrl: item.posterUrl ?? null,
        backdropUrl: item.backdropUrl ?? null,
        logoUrl,
        // Trailer
        videoLink,
        // TMDB match
        tmdbId,
      },
    });
  };

  const handleApplied = (id: string, patch: Partial<MediaDoc>) => {
    setMovies((prev) => {
      const updated = prev.map((it) =>
        it.id === id ? ({ ...it, ...patch } as MovieWithId) : it
      );

      // keep cache in sync if it's for this uid
      if (uid && moviesCache?.uid === uid) {
        moviesCache = {
          uid,
          movies: updated,
          ts: moviesCache.ts,
        };
      }

      return updated;
    });
  };

  const handleRefresh = async () => {
    if (!uid) return;
    setIsRefreshing(true);
    try {
      await fetchMovies({ forceNetwork: true });
      toast({ title: "Library refreshed" });
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
                  setSelectedTitle(getDisplayTitle(item));
                  setOpen(true);
                }}
              />
            );
          })}
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
