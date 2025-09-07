
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  query,
  orderBy as fbOrderBy,
  limit as fbLimit,
  startAfter,
  getDocs,
  where as fbWhere,
  QueryConstraint,
  Query,
  DocumentData,
  QueryDocumentSnapshot,
  WhereFilterOp
} from 'firebase/firestore';
import { db } from '@/lib/firebase.client';

export type QueryOpts<T> = {
  collectionPath: string | undefined;
  where?: Array<[field: string, op: WhereFilterOp, value: any]>;
  orderBy: [field: string, direction?: 'asc' | 'desc'];
  pageSize: number;
  map?: (doc: QueryDocumentSnapshot<DocumentData>) => T;
};

export function useInfiniteFirestore<T>({
  collectionPath,
  where,
  orderBy,
  pageSize,
  map = (doc) => ({ id: doc.id, ...doc.data() } as any),
}: QueryOpts<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const observer = useRef<IntersectionObserver>();

  const reset = useCallback(() => {
    setItems([]);
    setLastDoc(null);
    setHasMore(true);
    setLoading(true);
  }, []);

  const fetchNextPage = useCallback(async () => {
    if (!collectionPath) return;

    setLoading(true);

    try {
      const constraints: QueryConstraint[] = [];
      if (where) {
        where.forEach(([field, op, value]) => {
          constraints.push(fbWhere(field, op, value));
        });
      }
      constraints.push(fbOrderBy(orderBy[0], orderBy[1]));
      if (lastDoc) {
        constraints.push(startAfter(lastDoc));
      }
      constraints.push(fbLimit(pageSize));

      const q = query(collection(db, collectionPath), ...constraints);
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setHasMore(false);
      } else {
        const newItems = snapshot.docs.map(map);
        setItems((prevItems) => {
            const existingIds = new Set(prevItems.map((item: any) => item.id));
            const uniqueNewItems = newItems.filter((item: any) => !existingIds.has(item.id));
            return [...prevItems, ...uniqueNewItems];
        });
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        setHasMore(snapshot.docs.length === pageSize);
      }
    } catch (error) {
      console.error("Error fetching Firestore data:", error);
    } finally {
      setLoading(false);
    }
  }, [collectionPath, where, orderBy, pageSize, map, lastDoc]);
  
  useEffect(() => {
    // This effect runs only when dependencies change, effectively resetting and loading the first page.
    reset();
    if(collectionPath) {
        fetchNextPage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath]); // We only want to reset on collectionPath change

  const attachSentinel = useCallback((el: HTMLElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        fetchNextPage();
      }
    });

    if (el) observer.current.observe(el);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasMore]); // Dependencies are stable, but hook should re-attach if state changes.

  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, []);

  return { items, loading, hasMore, attachSentinel, reset };
}
