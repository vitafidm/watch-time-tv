// src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { MediaItem } from "@/lib/types";
import { useSearch } from "@/hooks/use-search";
import { useAuthUser } from "@/hooks/useAuthUser";
import { MediaCarousel } from "@/components/media-carousel";
import { NewCollectionModal } from "@/components/NewCollectionModal";
import { HomepageHero, type HeroData } from "@/components/HomepageHero";
import {
  fetchPinnedCollectionsWithItems,
  getCollection,
  getCollectionItemsOrdered,
  getCollectionOrder,
} from "@/lib/collections";
import {
  MediaEditModal,
  type MediaEditModalItem,
} from "@/components/MediaEditModal";
import { PlayerDialog } from "@/components/PlayerDialog";

import {
  collection,
  doc,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { resolveShowPlayTargetByRef } from "@/lib/resolveShowPlay";
import { useContinueWatching } from "@/hooks/useContinueWatching";


type PinnedRow = {
  id: string;
  title: string;
  // styles: 'vertical-posters-small' | 'vertical-posters-large' | 'horizontal-posters-large'
  style?: string;
  items: MediaItem[];
};

function normalizeGenres(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (typeof raw[0] === "string") return raw as string[];
    if (typeof raw[0] === "object" && raw[0]?.name) {
      return (raw as Array<{ name?: string }>).map((g) => g?.name).filter(Boolean) as string[];
    }
  }
  if (Array.isArray(raw?.genreNames)) return raw.genreNames as string[];
  if (Array.isArray(raw?.genresList)) return raw.genresList as string[];
  return [];
}

const FALLBACK_RELEASE_DATE = "2000-01-01";

type HeroPick = HeroData & {
  kind: "movie" | "tv";
  movieMediaId?: string | null; // movies: streamable id
  showRefPath?: string | null; // shows: Firestore path to show doc
};

export default function BrowsePage() {
  const { searchTerm } = useSearch();
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const [pinned, setPinned] = useState<PinnedRow[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState<boolean>(true);
  const [hero, setHero] = useState<HeroPick | null>(null);
  const [heroLoading, setHeroLoading] = useState<boolean>(true);

  // Media edit + player state
  const [editingItem, setEditingItem] = useState<MediaEditModalItem | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(undefined);
  const [selectedStartTime, setSelectedStartTime] = useState<number | null>(null);
  const { items: continueItems, loading: continueLoading } = useContinueWatching({ uid, max: 20 });


  // Map pinned collections -> MediaItem[], allowing either poster OR backdrop
  async function loadPinned() {
    if (!uid) {
      setPinned([]);
      setPinnedLoading(false);
      return;
    }

    setPinnedLoading(true);
    try {
      // Fetch rows + saved priority in parallel
      const [rows, order] = await Promise.all([
        fetchPinnedCollectionsWithItems(uid, 24),
        getCollectionOrder(uid).catch(() => [] as string[]),
      ]);

      // 1) Base map — keep poster/backdrop; title prefers showTitle/normalizedTitle
      let mapped: PinnedRow[] = rows.map((r) => {
        const items: MediaItem[] = r.items
          .map((it: any) => {
            const displayTitle =
              it.mediaType === "show" ? it.showTitle ?? it.title : it.normalizedTitle ?? it.title;

            const poster =
              typeof it.posterPath === "string" && it.posterPath.trim()
                ? it.posterPath
                : undefined;

            const backdrop =
              (typeof it.backdropPath === "string" && it.backdropPath.trim() && it.backdropPath) ||
              (typeof it.backdropUrl === "string" && it.backdropUrl.trim() && it.backdropUrl) ||
              (typeof it.backdrop_path === "string" && it.backdrop_path.trim() && it.backdrop_path) ||
              undefined;

            const year =
              typeof it.year === "number" && isFinite(it.year) && it.year > 1800
                ? `${it.year}-01-01`
                : FALLBACK_RELEASE_DATE;

            // Allow either poster or backdrop so something renders; we'll hydrate what's missing
            if (!poster && !backdrop) return null;

            return {
              id: it.mediaId,
              title: displayTitle,
              poster_path: poster,
              backdrop_path: backdrop,
              release_date: year,
              media_type: it.mediaType === "show" ? "tv" : "movie",
              overview: it.overview || "",
              // NOTE: overview/genres will be hydrated below for horizontal/featured
            } as MediaItem;
          })
          .filter(Boolean) as MediaItem[];

        return {
          id: r.id,
          title: r.title,
          style: r.style ?? "vertical-posters-small",
          items,
        };
      });

      // 2) Hydrate from canonical docs (movies => users/{uid}/media, shows => users/{uid}/shows)
      {
        const hydrateTasks: Promise<void>[] = [];

        mapped.forEach((row, rowIdx) => {
          row.items.forEach((item, itemIdx) => {
            hydrateTasks.push(
              (async () => {
                try {
                  const isTv = item.media_type === "tv";
                  const basePath = isTv ? `users/${uid}/shows` : `users/${uid}/media`;
                  const ref = doc(db, basePath, String(item.id));
                  const snap = await getDoc(ref);
                  if (!snap.exists()) return;

                  const d: any = snap.data();

                  const title = isTv
                    ? (typeof d.showTitle === "string" && d.showTitle.trim())
                      ? d.showTitle
                      : (d.title ?? item.title)
                    : (typeof d.normalizedTitle === "string" && d.normalizedTitle.trim())
                      ? d.normalizedTitle
                      : (d.title ?? item.title);

                  const poster = (typeof d.posterUrl === "string" && d.posterUrl.trim())
                    ? d.posterUrl
                    : item.poster_path;

                  const backdrop = (typeof d.backdropUrl === "string" && d.backdropUrl.trim())
                    ? d.backdropUrl
                    : item.backdrop_path;

                  mapped[rowIdx].items[itemIdx] = {
                    ...item,
                    title,
                    poster_path: poster,
                    backdrop_path: backdrop,
                    overview: d?.overview || d?.description || "",
                  } as any;
                } catch {
                  // Ignore failures; leave item as-is
                }
              })()
            );
          });
        });

        if (hydrateTasks.length) {
          await Promise.all(hydrateTasks);
        }
      }

      // 3) Apply saved priority order to rows
      const rank = new Map<string, number>();
      order.forEach((id, i) => rank.set(id, i));
      mapped.sort((a, b) => {
        const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Number.POSITIVE_INFINITY;
        const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Number.POSITIVE_INFINITY;
        return ra - rb;
      });

      setPinned(mapped);
    } catch {
      setPinned([]);
    } finally {
      setPinnedLoading(false);
    }
  }

  useEffect(() => {
    void loadPinned();
  }, [uid]);

  // Edit Collection modal
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<{
    id: string;
    initialTitle: string;
    initialStyle: string;
    initialPinnedToHome: boolean;
    initialSelected: Array<{
      mediaId: string;
      mediaType: "movie" | "show";
      title: string;
      posterPath?: string | null;
      year?: number | null;
    }>;
  } | null>(null);

  async function openEdit(collectionId: string) {
    if (!uid) return;
    const meta = await getCollection(uid, collectionId);
    const items = await getCollectionItemsOrdered(uid, collectionId);
    setEditState({
      id: collectionId,
      initialTitle: meta.title ?? "",
      initialStyle: meta.style ?? "vertical-posters-small",
      initialPinnedToHome: !!meta.pinnedToHome,
      initialSelected: items.map((it: any) => ({
        mediaId: it.mediaId,
        mediaType: it.mediaType,
        title: it.title,
        posterPath: it.posterPath ?? null,
        year: typeof it.year === "number" ? it.year : null,
      })),
    });
    setEditOpen(true);
  }

  async function refreshPinned() {
    await loadPinned();
  }

  useEffect(() => {
    const handler = () => {
      void refreshPinned();
    };
    window.addEventListener("media-artwork-updated", handler as EventListener);
    return () => window.removeEventListener("media-artwork-updated", handler as EventListener);
  }, []);

  // ✅ NICE UX: Optimistically patch the edited media across visible pinned rows
  const handleApplied = (id: string, patch: Partial<any>) => {
    const nextTitle =
      (patch as any).displayTitle ??
      (patch as any).normalizedTitle ??
      undefined;
    const nextPoster = (patch as any).posterUrl as string | undefined;
    const nextBackdrop = (patch as any).backdropUrl as string | undefined;

    setPinned((prev) =>
      prev.map((row) => ({
        ...row,
        items: row.items.map((it) => {
          if (String(it.id) !== String(id)) return it;
          return {
            ...it,
            ...(nextTitle ? { title: nextTitle } : {}),
            ...(nextPoster ? { poster_path: nextPoster } : {}),
            ...(nextBackdrop ? { backdrop_path: nextBackdrop } : {}),
          };
        }),
      }))
    );
  };

  // HOMEPAGE HERO: fetch a small pool (movies + shows), pick one random, render once
  useEffect(() => {
    if (!uid) {
      setHero(null);
      setHeroLoading(false);
      return;
    }

    let cancelled = false;
    setHeroLoading(true);

    const mapMovie = (d: any, docId: string): HeroPick | null => {
      if (d?.type !== "movie") return null;

      const resolvedTitle =
        typeof d?.normalizedTitle === "string" && d.normalizedTitle.trim()
          ? d.normalizedTitle
          : (d?.title ?? "");

      const backdropUrl = d?.backdropUrl || null;
      const posterUrl = d?.posterUrl || null;
      if (!resolvedTitle || (!backdropUrl && !posterUrl)) return null;

      return {
        kind: "movie",
        title: resolvedTitle,
        overview: d?.overview || d?.description || "",
        mediaType: "movie",
        videoLink: d?.videoLink || null,
        backdropUrl,
        posterUrl,
        tmdbId: d?.tmdbId ?? d?.tmdbMovieId ?? null,
        releaseDate: d?.releaseDate || "",
        voteAverage: d?.voteAverage ?? 0,
        genres: Array.isArray(d?.genres) ? (d.genres as string[]) : [],
        movieMediaId: d?.mediaId ?? docId,
        showRefPath: null,
      };
    };

    const mapShow = (d: any, refPath: string): HeroPick | null => {
      const resolvedTitle =
        typeof d?.showTitle === "string" && d.showTitle.trim()
          ? d.showTitle
          : (d?.title ?? "");

      const backdropUrl = d?.backdropUrl || null;
      const posterUrl = d?.posterUrl || null;
      if (!resolvedTitle || (!backdropUrl && !posterUrl)) return null;

      return {
        kind: "tv",
        title: resolvedTitle,
        overview: d?.overview || d?.description || "",
        mediaType: "tv",
        videoLink: d?.videoLink || null,
        backdropUrl,
        posterUrl,
        tmdbId: d?.tmdbId ?? d?.tmdbShowId ?? null,
        releaseDate: d?.firstAirDate || "",
        voteAverage: d?.voteAverage ?? 0,
        genres: Array.isArray(d?.genres) ? (d.genres as string[]) : [],
        movieMediaId: null,
        showRefPath: refPath,
      };
    };

    async function loadRandomHero() {
      try {
        const moviesQ = query(collection(db, `users/${uid}/media`), limit(24));
        const showsQ = query(collection(db, `users/${uid}/shows`), limit(24));

        const [moviesSnap, showsSnap] = await Promise.all([getDocs(moviesQ), getDocs(showsQ)]);

        const candidates: HeroPick[] = [];

        moviesSnap.forEach((snap) => {
          const mapped = mapMovie(snap.data(), snap.id);
          if (mapped) candidates.push(mapped);
        });

        showsSnap.forEach((snap) => {
          const mapped = mapShow(snap.data(), snap.ref.path);
          if (mapped) candidates.push(mapped);
        });

        if (cancelled) return;

        if (candidates.length === 0) {
          setHero(null);
          setHeroLoading(false);
          return;
        }

        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        setHero(pick);
      } catch {
        setHero(null);
      } finally {
        if (!cancelled) setHeroLoading(false);
      }
    }

    void loadRandomHero();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return (
    <div className="space-y-12">
      {/* 0) Homepage Hero */}
      {heroLoading && (
        <div className="relative aspect-video w-full rounded-xl overflow-hidden">
          <div className="absolute inset-0 animate-pulse bg-muted/40" />
        </div>
      )}
      {!heroLoading && hero && (
        <HomepageHero
          item={hero}
          onPlay={async () => {
            if (!uid) return;

            if (hero.kind === "movie") {
              const movieId = hero.movieMediaId ?? null;
              if (movieId) {
                setSelectedMediaId(movieId);
                setSelectedStartTime(null); // clear any prior resume
                setSelectedTitle(hero.title);
                setPlayerOpen(true);
              }
              return;
            }

            if (hero.kind === "tv" && hero.showRefPath) {
              try {
                const { mediaId, startTime, title } = await resolveShowPlayTargetByRef(hero.showRefPath);
                setSelectedMediaId(mediaId);
                setSelectedStartTime(startTime ?? 0);
                setSelectedTitle(title ?? hero.title);
                setPlayerOpen(true);
              } catch {
                // swallow (optional: toast)
              }
              return;
            }
          }}
        />
      )}

      {/* Empty-state callout for Collections */}
      {!pinnedLoading && pinned.length === 0 && (
        <div
          role="region"
          aria-label="No collections callout"
          className="rounded-xl border bg-muted/30 p-6 shadow-sm"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Customize your dashboard</h3>
              <p className="text-sm text-muted-foreground">
                Create your first collection to pin rows on your homepage.
              </p>
            </div>

            <Link href="/collections" className="shrink-0 self-start sm:self-auto">
              <Button>Go to Collections</Button>
            </Link>
          </div>

          {/* Preview skeletons */}
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] w-full rounded-xl border overflow-hidden"
              >
                <div style={{ background: "#404040" }} className="h-full w-full bg-muted/40 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      )}

{/* Continue Watching */}
{!continueLoading && continueItems.length > 0 && (
  <MediaCarousel
    title="Continue Watching"
    items={continueItems.map((it) => ({
      id: it.id,
      title: it.title,
      poster_path: it.poster_path,
      backdrop_path: it.backdrop_path,
      release_date: it.release_date ?? "2000-01-01",
      media_type: it.media_type,
    }))}
    peekNext
    loop={false}
    showArrows={false}
    layout="horizontal"
    cardOverrides={{
      showTitle: true,
      showYear: false,
      showWatchlist: false,
      size: "lg",
    }}
    // enable per-card progress overlays
    enableProgress
    uid={uid}
    getItemHref={(it) =>
      it.media_type === "tv" ? `/television/${it.id}` : `/movies/${it.id}`
    }
    onPlayItem={async (it, opts) => {
      if (!uid) return;

      // For Continue Watching, `it.id` is an actual media document id (movie or episode)
      // We want to *play that specific item*, not resolve show → first episode.
      // `opts?.startTime` carries restart/resume from the card.
      setSelectedMediaId(it.id);
      setSelectedStartTime(
        typeof opts?.startTime === "number" ? opts.startTime : null
      );
      setSelectedTitle(it.title);
      setPlayerOpen(true);
    }}
  />
)}


      {/* 1) User-pinned Collections (if any) */}
      {pinned.map((row) => {
        const isHorizontal =
          row.style === "horizontal-posters-large" || row.style === "horizontal-posters-small";

        const isFeatured = row.style === "horizontal-poster-featured"; // 👈 NEW

        const layout = isFeatured ? "featured" : isHorizontal ? "horizontal" : "vertical";

        const size =
          row.style === "vertical-posters-large" || row.style === "horizontal-posters-large"
            ? "lg"
            : "sm";

        return (
          <MediaCarousel
            key={`pinned:${row.id}`}
            title={row.title}
            items={row.items}
            peekNext
            loop
            showArrows={false}
            layout={layout as any}
            cardOverrides={{
              showTitle: !isFeatured && layout === "horizontal",
              showYear: false,
              showWatchlist: false,
              size,
            }}
            getItemHref={(it) =>
              it.media_type === "tv" ? `/television/${it.id}` : `/movies/${it.id}`
            }
            enableProgress
            uid={uid}
            onPlayItem={async (it, opts) => {
              if (!uid) return;
      
              // MOVIE: id is already a streamable mediaId
              if (it.media_type !== "tv") {
                setSelectedMediaId(it.id);
      
                // ✅ Respect the resume time sent from the card (MediaCarousel / MediaCard)
                const startTime =
                  typeof opts?.startTime === "number" ? opts.startTime : null;
      
                setSelectedStartTime(startTime);
                setSelectedTitle(it.title);
                setPlayerOpen(true);
                return;
              }
      
              // TV: resolve via show-level helper (nextUp -> lastPlayed -> first)
              try {
                const showRefPath = `users/${uid}/shows/${it.id}`;
                const { mediaId, startTime, title } = await resolveShowPlayTargetByRef(showRefPath);
                setSelectedMediaId(mediaId);
                setSelectedStartTime(startTime ?? 0);
                setSelectedTitle(title ?? it.title);
                setPlayerOpen(true);
              } catch {
                // optional: toast
              }
            }}
            onEditMedia={(it) => {
              if (!uid) return;
              const kind = it.media_type === "tv" ? "show" : "movie";
              const collectionPath =
                kind === "movie" ? `users/${uid}/media` : `users/${uid}/shows`;
              setEditingItem({
                id: it.id,
                collectionPath,
                kind: kind as "movie" | "show",
                current: {
                  title: it.title,
                  normalizedTitle: undefined,
                  posterUrl: it.poster_path,
                },
              });
            }}
          />
        );
      })}

      {/* Edit Collection modal (reused) */}
      <NewCollectionModal
        open={editOpen}
        onOpenChange={setEditOpen}
        uid={uid}
        mode="edit"
        collectionId={editState?.id}
        initialTitle={editState?.initialTitle}
        initialStyle={editState?.initialStyle}
        initialPinnedToHome={editState?.initialPinnedToHome}
        initialSelected={editState?.initialSelected ?? []}
        onSaved={refreshPinned}
      />

      <MediaEditModal
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onApplied={handleApplied}
        onAfterUpdate={() => {
          void refreshPinned();
        }}
      />

      <PlayerDialog
        open={playerOpen}
        onOpenChange={setPlayerOpen}
        mediaId={selectedMediaId}
        title={selectedTitle}
        startTime={selectedStartTime}
      />
    </div>
  );
}
