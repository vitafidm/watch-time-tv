"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  onSnapshot,
  FirestoreError,
} from "firebase/firestore";
import { db } from "@/lib/firebase.client";
import type { MediaDoc } from "@/lib/db.types";

type HookState<T> = { data: T[]; loading: boolean; error: string | null };
type MediaWithId = MediaDoc & { id: string };

function mapMediaDoc(d: any, id: string): MediaWithId {
  const playCount = typeof d.playCount === "number" ? d.playCount : 0;
  return { id, ...d, playCount } as MediaWithId;
}

export function useRecentlyAdded(uid: string, limitN = 24): HookState<MediaWithId> {
  const [state, setState] = useState<HookState<MediaWithId>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({ data: [], loading: false, error: null });
      return;
    };
    const q = query(
      collection(db, `users/${uid}/media`),
      orderBy("updatedAt", "desc"),
      fbLimit(limitN)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => mapMediaDoc(doc.data(), doc.id));
        setState({ data: rows, loading: false, error: null });
      },
      (err: FirestoreError) => {
        console.warn("useRecentlyAdded error:", err);
        setState((s) => ({ ...s, loading: false, error: err.message, data: [] }));
      }
    );
    return () => unsub();
  }, [uid, limitN]);

  return state;
}

export function useMediaByType(
  uid: string,
  type: "movie" | "episode",
  limitN = 24
): HookState<MediaWithId> {
  const [state, setState] = useState<HookState<MediaWithId>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const q = query(
      collection(db, `users/${uid}/media`),
      where("type", "==", type),
      orderBy("updatedAt", "desc"),
      fbLimit(limitN)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => mapMediaDoc(doc.data(), doc.id));
        setState({ data: rows, loading: false, error: null });
      },
      (err: FirestoreError) => {
        console.warn("useMediaByType error:", err);
        setState((s) => ({ ...s, loading: false, error: err.message, data: [] }));
      }
    );
    return () => unsub();
  }, [uid, type, limitN]);

  return state;
}

export function useTrending(uid: string, limitN = 24): HookState<MediaWithId> {
  const [state, setState] = useState<HookState<MediaWithId>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const q = query(
      collection(db, `users/${uid}/media`),
      orderBy("playCount", "desc"),
      orderBy("updatedAt", "desc"),
      fbLimit(limitN)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => mapMediaDoc(doc.data(), doc.id));
        setState({ data: rows, loading: false, error: null });
      },
      (err: FirestoreError) => {
        console.warn("useTrending error:", err);
        setState((s) => ({ ...s, loading: false, error: err.message, data: [] }));
      }
    );
    return () => unsub();
  }, [uid, limitN]);

  return state;
}
