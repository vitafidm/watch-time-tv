
"use client";

import { useEffect, useState, useCallback } from "react";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  FirestoreError,
} from "firebase/firestore";
import { db } from "@/lib/firebase.client";
import { useAuthUser } from "@/hooks/useAuthUser";

export type ServerConfig = {
  provider?: "direct";
  backendUrl?: string;
  mediaRoots?: {
    moviesPath?: string;
    tvPath?: string;
  };
  updatedAt?: any;
};

type State = {
  authed: boolean;
  loading: boolean;
  saving: boolean;
  config: ServerConfig;
  error: string | null;
};

export function useServerConfig() {
  const { user, loading: authLoading } = useAuthUser();
  const [state, setState] = useState<State>({
    authed: false,
    loading: true,
    saving: false,
    config: {},
    error: null,
  });

  const setConfig = useCallback(
    (updater: (c: ServerConfig) => ServerConfig) => {
      setState((s) => ({ ...s, config: updater(s.config) }));
    },
    []
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState((s) => ({ ...s, authed: false, loading: false, config: {}, error: null }));
      return;
    }

    const ref = doc(db, `users/${user.uid}/serverConfig`, "config");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.exists() ? (snap.data() as ServerConfig) : {}) || {};
        setState((s) => ({
          ...s,
          authed: true,
          loading: false,
          config: data,
          error: null,
        }));
      },
      (err: FirestoreError) => {
        console.warn("useServerConfig onSnapshot error:", err);
        setState((s) => ({
          ...s,
          authed: !!user,
          loading: false,
          error: err.message,
        }));
      }
    );

    return () => unsub();
  }, [user, authLoading]);

  const persist = useCallback(
    async (next: ServerConfig) => {
      if (!user) throw new Error("Not signed in");
      setState((s) => ({ ...s, saving: true, error: null }));
      try {
        const payload: ServerConfig = {
          provider: next.provider ?? "direct",
          backendUrl: next.backendUrl?.trim(),
          mediaRoots: {
            moviesPath: next.mediaRoots?.moviesPath?.trim(),
            tvPath: next.mediaRoots?.tvPath?.trim(),
          },
          updatedAt: serverTimestamp(),
        };
        const ref = doc(db, `users/${user.uid}/serverConfig`, "config");
        await setDoc(ref, payload, { merge: true });
      } finally {
        setState((s) => ({ ...s, saving: false }));
      }
    },
    [user]
  );

  return {
    authed: state.authed,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    config: state.config,
    setConfig,
    persist,
  };
}
