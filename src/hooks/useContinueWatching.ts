// src/hooks/useContinueWatching.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";
import type { MediaItem } from "@/lib/types";
import {
  collection,
  doc,
  getDoc,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const RESUME_MIN_SECONDS = 10;

export type ContinueWatchingItem = MediaItem & {
  // Resume metadata
  resumeSeconds: number;
  durationSeconds: number;
  progressPct: number; // 0..100
  resumeLabel: string; // "1:23:45"
};

export function useContinueWatching(opts?: {
  /** Max number of items to return. Default 24. */
  limit?: number;
  /** Hide crumbs (< 10s). Default true. */
  hideSmallPositions?: boolean;
}) {
  const { user } = useAuthUser();
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState<boolean>(!!uid);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);

  const unsubRef = useRef<null | (() => void)>(null);
  const limitCount = Math.max(1, Math.min(100, opts?.limit ?? 24));
  const hideSmall = opts?.hideSmallPositions !== false;

  useEffect(() => {
    // cleanup old listener
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setItems([]);
    setError(null);

    if (!uid) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const pbCol = collection(db, `users/${uid}/playback`);
    const q = query(pbCol, orderBy("lastPlayedAt", "desc"), qLimit(limitCount));

    unsubRef.current = onSnapshot(
      q,
      async (snap) => {
        try {
          const rows = snap.docs
            .map((d) => {
              const data = d.data() as any;
              const mediaId: string | null =
                typeof data.mediaId === "string" ? data.mediaId : d.id;
              const lastPosition: number =
                typeof data.lastPosition === "number" ? data.lastPosition : 0;
              const duration: number =
                typeof data.duration === "number" && data.duration > 0
                  ? data.duration
                  : 0;

              return { mediaId, lastPosition, duration };
            })
            .filter((r) => r.mediaId && r.duration > 0);

          const filtered = rows.filter((r) =>
            hideSmall ? r.lastPosition >= RESUME_MIN_SECONDS : true
          );

          // Hydrate media docs in parallel (cap concurrency by chunking)
          const chunkSize = 10;
          const chunks: typeof filtered[] = [];
          for (let i = 0; i < filtered.length; i += chunkSize) {
            chunks.push(filtered.slice(i, i + chunkSize));
          }

          const hydrated: ContinueWatchingItem[] = [];
          for (const chunk of chunks) {
            const docs = await Promise.all(
              chunk.map(async (r) => {
                const mref = doc(db, `users/${uid}/media/${r.mediaId}`);
                const msnap = await getDoc(mref);
                return { r, msnap };
              })
            );

            for (const { r, msnap } of docs) {
              if (!msnap.exists()) continue;
              const m = msnap.data() as any;

              // Decide display fields (movies vs episodes)
              const isEpisode = m?.type === "episode";
              const media_type: "movie" | "tv" =
                isEpisode ? "tv" : "movie";

              const displayTitle = isEpisode
                ? (typeof m.title === "string" && m.title.trim()) ||
                  `${m?.showTitle ?? "Episode"} S${m?.season}E${m?.episode}`
                : (typeof m.normalizedTitle === "string" && m.normalizedTitle.trim()) ||
                  (m?.title ?? "");

              // Artwork: prefer canonical poster/backdrop
              const poster_path =
                (typeof m.posterUrl === "string" && m.posterUrl.trim()) || undefined;
              const backdrop_path =
                (typeof m.backdropUrl === "string" && m.backdropUrl.trim()) || undefined;

              // Dates (carousels expect string like "YYYY-MM-DD")
              const release_date =
                (typeof m.releaseDate === "string" && m.releaseDate) ||
                (typeof m.firstAirDate === "string" && m.firstAirDate) ||
                "2000-01-01";

              const overview: string =
                (typeof m.overview === "string" && m.overview) ||
                (typeof m.description === "string" && m.description) ||
                "";

              const progressPct = Math.max(
                0,
                Math.min(100, Math.round((r.lastPosition / r.duration) * 100))
              );

              const resumeSeconds = Math.max(0, Math.floor(r.lastPosition));
              const durationSeconds = Math.max(1, Math.floor(r.duration));

              const item: ContinueWatchingItem = {
                id: r.mediaId,
                title: displayTitle || "Untitled",
                poster_path,
                backdrop_path,
                release_date,
                media_type,
                overview,
                resumeSeconds,
                durationSeconds,
                progressPct,
                resumeLabel: formatHMS(resumeSeconds),
              };

              hydrated.push(item);
            }
          }

          setItems(hydrated);
          setLoading(false);
        } catch (e: any) {
          setError(e?.message || "Failed to load Continue Watching");
          setLoading(false);
        }
      },
      (err) => {
        setError(err?.message || "Failed to load Continue Watching");
        setLoading(false);
      }
    );

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [uid, limitCount, hideSmall]);

  return { items, loading, error };
}

/** 65 -> "1:05", 3723 -> "1:02:03" */
function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}
