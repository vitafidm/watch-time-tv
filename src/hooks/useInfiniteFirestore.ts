// src/hooks/useInfiniteFirestore.ts
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  collection,
  query,
  orderBy as fbOrderBy,
  limit as fbLimit,
  startAfter,
  getDocs,
  where as fbWhere,
  QueryConstraint,
  QueryDocumentSnapshot,
  DocumentData,
  WhereFilterOp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase.client';

export type QueryOpts<T> = {
  collectionPath: string | undefined;
  where?: Array<[field: string, op: WhereFilterOp, value: any]>;
  orderBy: [field: string, direction?: 'asc' | 'desc'];
  pageSize: number;
  map?: (doc: QueryDocumentSnapshot<DocumentData>) => T;

  /** How far before the sentinel enters the viewport to load the next page (px). */
  overscanPx?: number; // default 900

  /** Minimum # of skeletons to show while we’re fetching next. */
  minRemaining?: number; // default 6

  /** Optional: disable auto-observer and control pagination manually */
  auto?: boolean; // default true
};

export function useInfiniteFirestore<T>({
  collectionPath,
  where,
  orderBy,
  pageSize,
  map = (doc) => ({ id: doc.id, ...doc.data() } as any),
  overscanPx = 900,
  minRemaining = 6,
  auto = true,
}: QueryOpts<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [isFetchingNext, setIsFetchingNext] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const observer = useRef<IntersectionObserver | null>(null);
  const observedEl = useRef<HTMLElement | null>(null);
  const inFlight = useRef<boolean>(false);

  const resetState = useCallback(() => {
    setItems([]);
    setLastDoc(null);
    setHasMore(true);
    setError(null);
    setLoadingInitial(true);
  }, []);

  const buildConstraints = useCallback((): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [];
    if (where) {
      for (const [field, op, value] of where) {
        constraints.push(fbWhere(field, op, value));
      }
    }
    constraints.push(fbOrderBy(orderBy[0], orderBy[1]));
    if (lastDoc) constraints.push(startAfter(lastDoc));
    constraints.push(fbLimit(pageSize));
    return constraints;
  }, [where, orderBy, pageSize, lastDoc]);

  const fetchNextPage = useCallback(async (isReset = false) => {
    if (!collectionPath || inFlight.current || (!hasMore && !isReset)) return;
    inFlight.current = true;
    if (!isReset) setIsFetchingNext(true);
    try {
      const q = query(collection(db, collectionPath), ...(isReset ? (() => {
        const c = [...buildConstraints()];
        // when resetting, ignore lastDoc
        const idx = c.findIndex(cn => (cn as any)?.type === 'QueryConstraint' && (cn as any).type === 'startAfter');
        if (idx >= 0) c.splice(idx, 1);
        return c;
      })() : buildConstraints()));

      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMore(false);
        if (isReset) setItems([]);
      } else {
        const newItems = snap.docs.map(map);

        if (isReset) {
          setItems(newItems);
        } else {
          setItems(prev => {
            const seen = new Set((prev as any[]).map((x) => x.id));
            const uniq = (newItems as any[]).filter((x) => !seen.has(x.id));
            return [...prev, ...uniq] as T[];
          });
        }

        setLastDoc(snap.docs[snap.docs.length - 1]);
        setHasMore(snap.docs.length === pageSize);
      }
    } catch (e) {
      setError(e);
    } finally {
      if (isReset) setLoadingInitial(false);
      setIsFetchingNext(false);
      inFlight.current = false;
    }
  }, [collectionPath, buildConstraints, map, pageSize, hasMore]);

  const resetAndFetch = useCallback(async () => {
    resetState();
    await fetchNextPage(true);
  }, [resetState, fetchNextPage]);

  // Kick off initial load whenever the collection path changes
  useEffect(() => {
    if (!collectionPath) {
      resetState();
      setLoadingInitial(false);
      return;
    }
    resetAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath]);

  // Observer
  const attachSentinel = useCallback((el: HTMLElement | null) => {
    observedEl.current = el;
    if (!auto) return;

    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }
    if (!el) return;

    observer.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isFetchingNext) {
          void fetchNextPage();
        }
      },
      {
        root: el.closest('[data-radix-scroll-area-viewport]') || null,
        rootMargin: `${overscanPx}px 0px`,
        threshold: 0,
      }
    );
    observer.current.observe(el);
  }, [auto, hasMore, isFetchingNext, fetchNextPage, overscanPx]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (observer.current) observer.current.disconnect();
    };
  }, []);

  // Placeholder count: show skeletons while the next page is on the way or likely soon
  const placeholderCount = useMemo(() => {
    if (!hasMore) return 0;
    // If we’re currently fetching next, we can mirror the page size (or a minimum).
    if (isFetchingNext) return Math.max(minRemaining, Math.min(pageSize, 12));
    // Not fetching yet, still show a small tail so the grid doesn’t feel "dead".
    return minRemaining;
  }, [hasMore, isFetchingNext, minRemaining, pageSize]);

  // For convenience, a callback form you can hand straight to React's `ref` prop
  const sentinelRefCallback = useCallback((node: HTMLElement | null) => {
    attachSentinel(node);
  }, [attachSentinel]);

  return {
    items,
    loading: loadingInitial,
    hasMore,
    error,
    isFetchingNext,
    placeholderCount,
    attachSentinel,        // manual method (your current pattern)
    sentinelRefCallback,   // alt: pass directly to `ref={sentinelRefCallback}`
    resetAndFetch,
    fetchNextPage,         // optional manual trigger
  };
}
