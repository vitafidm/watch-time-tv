
"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  getDocs,
  doc,
  getDoc,
  limit as fbLimit
} from "firebase/firestore";
import { db } from "@/lib/firebase.client";
import type { MediaDoc, PlaybackDoc } from "@/lib/db.types";

type Row = {
  mediaId: string;
  title: string;
  type: "movie" | "episode";
  posterUrl?: string | null;
  backdropUrl?: string | null;
  lastPosition: number;
  duration: number;
  progress: number; // 0..1
  lastPlayedAt: any;
};

export function useContinueWatching(uid: string, limitN = 24): { data: Row[]; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: Row[]; loading: boolean; error: string | null }>({
    data: [],
    loading: true,
    error: null
  });

  useEffect(() => {
    if (!uid) {
        setState({ data: [], loading: false, error: null });
        return;
    };

    const q = query(
      collection(db, `users/${uid}/playback`),
      orderBy("lastPlayedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const rows: Row[] = [];
        const playbackDocs = snap.docs.slice(0, limitN);

        for (const d of playbackDocs) {
          const pb = d.data() as PlaybackDoc;
          const progress = pb.duration > 0 ? Math.min(1, pb.lastPosition / pb.duration) : 0;

          if (progress >= 0.9) continue;

          const mRef = doc(db, `users/${uid}/media/${pb.mediaId}`);
          const mSnap = await getDoc(mRef);
          if (!mSnap.exists()) continue;
          
          const m = mSnap.data() as MediaDoc;

          rows.push({
            mediaId: pb.mediaId,
            title: m.title,
            type: m.type,
            posterUrl: m.posterUrl ?? null,
            backdropUrl: m.backdropUrl ?? null,
            lastPosition: pb.lastPosition ?? 0,
            duration: pb.duration ?? 0,
            progress,
            lastPlayedAt: pb.lastPlayedAt
          });
        }
        setState({ data: rows, loading: false, error: null });
      },
      (err) => {
        console.warn("useContinueWatching error:", err);
        setState({ data: [], loading: false, error: err.message });
      }
    );

    return () => unsub();
  }, [uid, limitN]);

  return state;
}
