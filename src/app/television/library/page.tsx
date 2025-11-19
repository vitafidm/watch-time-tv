"use client";

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Tv, RefreshCw, Play, Check } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useInfiniteFirestore } from "@/hooks/useInfiniteFirestore";
import { MediaEditButton } from "@/components/MediaEditButton";
import { MediaEditModal, type MediaEditModalItem } from "@/components/MediaEditModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/api";
import { useRouter } from "next/navigation";
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress";
import { db } from "@/lib/firebase";
import { doc, deleteDoc } from "firebase/firestore";

// Represents a document from the /users/{uid}/shows collection
type ShowDoc = {
  id: string;
  tmdbShowId: number;
  title: string;
  displayTitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  videoLink?: string;
  episodeCount?: number;
  updatedAt: any; // Firestore Timestamp
};

// --- Show Card -------------------------------------------------------------

function ShowCard({
  item,
  onEdit,
  progressPercent,
  resumeSeconds,
  onMarkWatched,
}: {
  item: ShowDoc;
  onEdit: () => void;
  progressPercent?: number;
  resumeSeconds?: number | null;
  onMarkWatched?: () => void;
}) {
  const displayTitle = item.displayTitle || item.title;
  const router = useRouter();

  const pct = Math.max(0, Math.min(100, Math.floor(progressPercent ?? 0)));
  const hasResume = typeof resumeSeconds === "number" && resumeSeconds >= 10;

  function formatTimeShort(sec: number | undefined) {
    if (!sec || sec <= 0) return "";
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, "0");
    const m = Math.floor(sec / 60);
    return `${m}:${s}`;
  }

  return (
    <Link
      href={`/television/${item.id}`}
      className="group block"
      data-testid="show-card"
      prefetch={false}
    >
      <div className="flex flex-col gap-2">
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 bg-muted">
          <Image
            src={item.posterUrl || `https://picsum.photos/500/750?random=${item.id}`}
            alt={displayTitle}
            width={500}
            height={750}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            data-ai-hint="tv show poster"
          />

          {/* Top-right: Mark as watched (only when there is resume/progress) */}
          {hasResume && onMarkWatched && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarkWatched();
              }}
              className="
                absolute top-2 right-2 z-20
                inline-flex items-center gap-1 rounded-full
                bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white
                opacity-0 transition-opacity duration-200
                backdrop-blur
                group-hover:opacity-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background
              "
              title="Mark show as watched"
              aria-label="Mark show as watched"
            >
              <Check className="h-3 w-3" />
              Mark as watched
            </button>
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
            className="absolute bottom-2 right-2 z-20 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 backdrop-blur group-hover:opacity-100"
            aria-label="Edit show"
            title="Edit show"
          >
            ●●●
          </button>

          {/* Center overlay + Play / Resume button (button, not Link) */}
          <div
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/0 opacity-0 transition-opacity duration-200 group-hover:bg-black/45 group-hover:opacity-100 group-focus-within:bg-black/45 group-focus-within:opacity-100"
            aria-hidden="true"
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation(); // don't trigger outer Link
                router.push(`/television/${item.id}`);
              }}
              className="pointer-events-auto inline-flex items-center justify-center h-14 rounded-full bg-background/60 px-5 text-foreground/90 shadow-lg ring-1 ring-border/50 transition hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
              aria-label={`${hasResume ? "Open show to resume" : "Open"} ${displayTitle}`}
            >
              <Play className="h-5 w-5 mr-2" aria-hidden="true" />
              <span className="text-sm font-bold">
                {hasResume
                  ? `Resume${resumeSeconds ? ` • ${formatTimeShort(resumeSeconds)}` : ""}`
                  : "Open"}
              </span>
            </button>
          </div>

          {/* Bottom progress bar (only if we have non-trivial progress) */}
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

        <div className="space-y-1">
          <h3 className="font-headline text-base font-bold text-foreground truncate">
            {displayTitle}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {item.episodeCount || 0} {item.episodeCount === 1 ? "episode" : "episodes"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// --- TV Library Page -------------------------------------------------------

function TvLibrary() {
  const { user } = useAuthUser();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    items: fetchedShows,
    loading,
    hasMore,
    attachSentinel,
    resetAndFetch,
    isFetchingNext,
    placeholderCount,
  } = useInfiniteFirestore<ShowDoc>({
    collectionPath: user ? `users/${user.uid}/shows` : undefined,
    where: [["episodeCount", ">", 0]],
    orderBy: ["updatedAt", "desc"],
    pageSize: 24,
    overscanPx: 1200, // start loading well before the gap
    minRemaining: 6, // tail skeletons
    map: (doc) => ({ id: doc.id, ...doc.data(), tmdbShowId: Number(doc.id) } as ShowDoc),
  });

  const [shows, setShows] = useState<ShowDoc[]>([]);
  useEffect(() => {
    setShows(fetchedShows);
  }, [fetchedShows]);

  const [editingItem, setEditingItem] = useState<MediaEditModalItem | null>(null);

  const handleEdit = (show: ShowDoc) => {
    if (!user) return;
    setEditingItem({
      id: String(show.id), // Doc ID is the show doc id
      collectionPath: `users/${user.uid}/shows`,
      kind: "show",
      current: {
        title: show.title,
        displayTitle: show.displayTitle,
        tmdbId: show.tmdbShowId,
        posterUrl: show.posterUrl,
        backdropUrl: show.backdropUrl,
        videoLink: show.videoLink,
      },
    });
  };

  const handleApplied = useCallback((id: string, patch: Partial<ShowDoc>) => {
    setShows((prev) => prev.map((s) => (String(s.id) === id ? { ...s, ...patch } : s)));
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  attachSentinel(sentinelRef.current);

  const showInitialLoading = loading && shows.length === 0;

  const handleRefresh = async () => {
    if (!user) return;

    setIsRefreshing(true);
    try {
      const idToken = await user.getIdToken();
      await callFunction("materializeUserShowsFromFolders", { uid: user.uid }, idToken);

      if (resetAndFetch) {
        await resetAndFetch();
      }

      toast({ title: "Library refreshed" });
    } catch (error: any) {
      console.error("Failed to refresh TV library:", error);
      toast({
        title: "Refresh failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // --- Show-level playback progress + mark-as-watched ---------------------

  const uid = user?.uid ?? null;

  const progressIds = useMemo(
    () => (uid ? shows.map((s) => String(s.id)) : []),
    [uid, shows]
  );

  // Realtime so that deleting a playback doc instantly updates the UI
  const progressMap = usePlaybackProgress(uid, progressIds, {
    realtime: true,
  });

  const handleMarkWatched = useCallback(
    async (show: ShowDoc) => {
      if (!user) return;

      try {
        const ref = doc(db, `users/${user.uid}/playback`, String(show.id));
        await deleteDoc(ref);
        toast({ title: "Marked as watched" });
        // progressMap will self-update via realtime listener
      } catch (error: any) {
        console.error("Failed to mark show as watched:", error);
        toast({
          title: "Failed to mark as watched",
          description: error.message,
          variant: "destructive",
        });
      }
    },
    [user, toast]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Tv className="h-8 w-8 text-primary" />
          <h1 className="font-headline text-4xl font-bold tracking-tight">TV Library</h1>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing || loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {showInitialLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-lg" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!showInitialLoading && shows.length > 0 && (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
          data-testid="tv-grid"
        >
          {shows.map((item) => {
            const prog = progressMap[String(item.id)];
            const progressPercent = prog?.percent ?? 0;
            const resumeSeconds = prog?.position ?? null;

            return (
              <ShowCard
                key={item.id}
                item={item}
                onEdit={() => handleEdit(item)}
                progressPercent={progressPercent}
                resumeSeconds={resumeSeconds}
                onMarkWatched={
                  resumeSeconds !== null ? () => handleMarkWatched(item) : undefined
                }
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

      {!loading && shows.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Tv className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-6 text-2xl font-headline text-foreground">No TV Shows Found</h2>
          <p className="mt-2 text-muted-foreground">
            Your TV library is empty. Connect an agent to add media or run the materializer
            function.
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
    </div>
  );
}

export default function TvLibraryPage() {
  return (
    <ProtectedRoute>
      <TvLibrary />
    </ProtectedRoute>
  );
}
