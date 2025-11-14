// src/hooks/usePlaybackProgress.ts
"use client";
import * as React from "react";
import { collection, getDocs, onSnapshot, query, where, documentId, Query, Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";

type ProgressRow = { position?: number; duration?: number; lastPosition?: number };
type ProgressMap = Record<string, { position: number; percent: number }>;

type Options = {
  realtime?: boolean;     // default false
  chunkSize?: number;     // default 10 (Firestore IN limit)
};

function useDeepStable<T>(value: T) {
  const json = JSON.stringify(value);
  const ref = React.useRef({ json, value });
  if (ref.current.json !== json) ref.current = { json, value };
  return ref.current.value;
}

export function usePlaybackProgress(
  uid: string | null,
  ids: string[],
  options?: Options
): ProgressMap {
  const { realtime = false, chunkSize = 10 } = options ?? {};
  const stable = useDeepStable({ uid, ids, realtime, chunkSize });

  const [map, setMap] = React.useState<ProgressMap>({});
  const unsubsRef = React.useRef<Unsubscribe[]>([]);

  React.useEffect(() => {
    // cleanup any prior listeners
    unsubsRef.current.forEach(u => { try { u(); } catch {} });
    unsubsRef.current = [];

    const { uid, ids, realtime, chunkSize } = stable;
    if (!uid || !ids || ids.length === 0) {
      setMap({});
      return;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

    const baseCol = collection(db, `users/${uid}/playback`);

    const updateMap = (partial: ProgressMap) =>
      setMap(prev => ({ ...prev, ...partial }));

    const queries: Query[] = chunks.map(ch =>
      query(baseCol, where(documentId(), "in", ch))
    );

    // one-time fetch (default) — minimal reads
    if (!realtime) {
      (async () => {
        const next: ProgressMap = {};
        for (const qy of queries) {
          const snap = await getDocs(qy);
          snap.forEach(docSnap => {
            const d = docSnap.data() as ProgressRow;
            const pos = Math.floor(d.lastPosition ?? d.position ?? 0);
            const dur = Math.max(1, Math.floor(d.duration ?? 0));
            const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
            next[docSnap.id] = { position: pos, percent: pct };
          });
        }
        setMap(next);
      })();
      return;
    }

    // realtime (opt-in) — still chunked, minimal churn
    for (const qy of queries) {
      const unsub = onSnapshot(qy, snap => {
        const partial: ProgressMap = {};
        snap.docChanges().forEach(ch => {
          const d = ch.doc.data() as ProgressRow;
          const pos = Math.floor(d.lastPosition ?? d.position ?? 0);
          const dur = Math.max(1, Math.floor(d.duration ?? 0));
          const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
          partial[ch.doc.id] = { position: pos, percent: pct };
        });
        if (Object.keys(partial).length) updateMap(partial);
      });
      unsubsRef.current.push(unsub);
    }

    return () => {
      unsubsRef.current.forEach(u => { try { u(); } catch {} });
      unsubsRef.current = [];
    };
  }, [stable]);

  return map;
}
