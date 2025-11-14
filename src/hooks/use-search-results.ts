"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, startAt, endAt } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useDebouncedValue } from "./use-debounced-value";

export type SearchKind = "movie" | "show";
export interface SearchResult {
  id: string;
  kind: SearchKind;
  normalizedTitle: string;        // display label (title for shows, normalizedTitle for movies)
  posterUrl?: string | null;
}

const END = "\uf8ff";

// Helpers
const toTitleCase = (s: string) =>
  s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const makeVariants = (s: string) => {
  const raw = s;
  const lower = s.toLowerCase();
  const title = toTitleCase(s);
  // de-dupe while preserving order
  const seen = new Set<string>();
  return [raw, lower, title].filter(v => {
    const keep = !!v && !seen.has(v);
    if (keep) seen.add(v);
    return keep;
  });
};

export function useSearchResults(rawTerm: string, opts?: { maxPerType?: number }) {
  const { user } = useAuthUser();
  const uid = user?.uid;
  const maxPerType = opts?.maxPerType ?? 8;

  // IMPORTANT: do NOT lowercase; debounce the raw input
  const debounced = useDebouncedValue((rawTerm ?? "").trim(), 200);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!uid) return;
    if (!debounced) { setResults([]); return; }

    let cancelled = false;

    const prefixQuery = async (colPath: string, field: string, prefix: string, take: number) => {
      const ref = collection(db, colPath);
      const qy = query(ref, orderBy(field), startAt(prefix), endAt(prefix + END), limit(take));
      const snap = await getDocs(qy);
      return snap.docs.map(d => ({ id: d.id, data: d.data() as any }));
    };

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const variants = makeVariants(debounced);

        // MOVIES — users/{uid}/media by normalizedTitle
        const movieField = "normalizedTitle";
        const moviePromises = variants.map(v =>
          prefixQuery(`users/${uid}/media`, movieField, v, maxPerType)
        );
        const movieSets = await Promise.allSettled(moviePromises);
        const moviesRaw = movieSets
          .filter(r => r.status === "fulfilled")
          .flatMap((r: any) => r.value as Array<{ id: string; data: any }>);

        // SHOWS — users/{uid}/shows by title
        const showField = "title";
        const showPromises = variants.map(v =>
          prefixQuery(`users/${uid}/shows`, showField, v, maxPerType)
        );
        const showSets = await Promise.allSettled(showPromises);
        const showsRaw = showSets
          .filter(r => r.status === "fulfilled")
          .flatMap((r: any) => r.value as Array<{ id: string; data: any }>);

        // Map + de-dupe
        const moviesMap = new Map<string, SearchResult>();
        for (const { id, data } of moviesRaw) {
          moviesMap.set(id, {
            id,
            kind: "movie",
            normalizedTitle: data.normalizedTitle ?? "",
            posterUrl: data.posterUrl ?? data.posterURL ?? null,
          });
        }

        const showsMap = new Map<string, SearchResult>();
        for (const { id, data } of showsRaw) {
          showsMap.set(id, {
            id,
            kind: "show",
            normalizedTitle: data.title ?? "",
            posterUrl: data.posterUrl ?? data.posterURL ?? null,
          });
        }

        if (!cancelled) {
          setResults([...moviesMap.values(), ...showsMap.values()]);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [uid, debounced, maxPerType]);

  const grouped = useMemo(() => {
    const movies = results.filter(r => r.kind === "movie");
    const shows  = results.filter(r => r.kind === "show");
    return { movies, shows };
  }, [results]);

  return { loading, error, results, grouped, hasQuery: !!debounced };
}
