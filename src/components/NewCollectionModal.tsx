// src/components/NewCollectionModal.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getFirestore, collection, query, where, orderBy, limit, getDocs, startAfter,
  DocumentData, QueryDocumentSnapshot
} from "firebase/firestore";
import {
  createCollectionWithItems, UserCollectionItem,
  getCollection, getCollectionItemsOrdered, updateCollectionMeta, upsertCollectionItems
} from "@/lib/collections";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uid: string;
  onSaved: () => void;

  mode?: Mode;
  collectionId?: string;

  initialTitle?: string;
  initialStyle?: string;
  initialSelected?: Array<Omit<UserCollectionItem, "order" | "addedAt">>;
  initialPinnedToHome?: boolean;
};

type GridItem = {
  id: string;
  mediaType: "movie" | "show";
  title: string;
  posterUrl?: string | null;
  year?: number;
  _bucket: "movies" | "shows";
};

type MediaFilter = "all" | "movie" | "show";

const PAGE_SIZE = 48;

export function NewCollectionModal({
  open,
  onOpenChange,
  uid,
  onSaved,
  mode = "create",
  collectionId,
  initialTitle = "",
  initialStyle = "vertical-posters-small",
  initialSelected = [],
  initialPinnedToHome = false,
}: Props) {
  const db = getFirestore();
  const { toast } = useToast();

  // Form state
  const [title, setTitle] = useState(initialTitle);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [style, setStyle] = useState(initialStyle);
  const [pinnedToHome, setPinnedToHome] = useState(initialPinnedToHome);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Record<string, Omit<UserCollectionItem,"order"|"addedAt">>>({});

  // Grid data + paging (stable, append-only)
  const [items, setItems] = useState<GridItem[]>([]);
  const moviesCursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const showsCursor  = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreMovies, setHasMoreMovies] = useState(true);
  const [hasMoreShows,  setHasMoreShows]  = useState(true);
  const [loadingPage,   setLoadingPage]   = useState(false);

  const loadId = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const keyFor = (it: GridItem) => `${it._bucket}:${it.id}`;
  const selectedCount = Object.keys(selected).length;
  const canLoadMore = useMemo(
    () =>
      filter === "movie"
        ? hasMoreMovies
        : filter === "show"
        ? hasMoreShows
        : hasMoreMovies || hasMoreShows,
    [filter, hasMoreMovies, hasMoreShows]
  );

  // Filter view is derived; underlying `items` stays in append order
  const filteredToRender = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter(i => i.mediaType === (filter === "movie" ? "movie" : "show")),
    [items, filter]
  );

  function resetAndLoad() {
    setItems([]);
    moviesCursor.current = null;
    showsCursor.current = null;
    setHasMoreMovies(true);
    setHasMoreShows(true);
    loadId.current += 1;
    void loadNextPage();
  }

  // --- Library queries ---
  async function fetchMoviesPage(): Promise<GridItem[]> {
    if (filter === "show" || !hasMoreMovies) return [];
    const base = collection(db, "users", uid, "media");
    const qy = moviesCursor.current
      ? query(base, where("tmdbType","==","movie"), orderBy("__name__"), startAfter(moviesCursor.current), limit(PAGE_SIZE))
      : query(base, where("tmdbType","==","movie"), orderBy("__name__"), limit(PAGE_SIZE));
    const snap = await getDocs(qy);
    if (snap.docs.length < PAGE_SIZE) setHasMoreMovies(false);
    if (snap.docs.length) moviesCursor.current = snap.docs[snap.docs.length - 1];
    return snap.docs.map(d => {
      const x = d.data() as any;
      return {
        id: d.id,
        mediaType: "movie" as const,
        title: x.title ?? x.name ?? "Untitled",
        posterUrl: x.posterUrl ?? null,
        year: x.year ?? x.releaseYear,
        _bucket: "movies" as const
      };
    });
  }

  async function fetchShowsPage(): Promise<GridItem[]> {
    if (filter === "movie" || !hasMoreShows) return [];
    const base = collection(db, "users", uid, "shows");
    const qy = showsCursor.current
      ? query(base, where("tmdbType","==","tv"), orderBy("__name__"), startAfter(showsCursor.current), limit(PAGE_SIZE))
      : query(base, where("tmdbType","==","tv"), orderBy("__name__"), limit(PAGE_SIZE));
    const snap = await getDocs(qy);
    if (snap.docs.length < PAGE_SIZE) setHasMoreShows(false);
    if (snap.docs.length) showsCursor.current = snap.docs[snap.docs.length - 1];
    return snap.docs.map(d => {
      const x = d.data() as any;
      return {
        id: d.id,
        mediaType: "show" as const,
        title: x.title ?? x.name ?? "Untitled",
        posterUrl: x.posterUrl ?? null,
        year: x.year ?? x.firstAirYear,
        _bucket: "shows" as const
      };
    });
  }

  /** Append-only merge (no resort), keeps scroll stable. */
  async function loadNextPage() {
    if (loadingPage || !uid) return;
    const myLoad = ++loadId.current;
    setLoadingPage(true);
    try {
      // Load both buckets (respects filter via early returns in each)
      const [m, s] = await Promise.all([fetchMoviesPage(), fetchShowsPage()]);
      setItems(prev => {
        if (myLoad !== loadId.current) return prev; // stale
        const seen = new Set(prev.map(keyFor));
        const next = prev.slice();

        // Append in deterministic order to avoid reshuffle (movies then shows)
        for (const it of m) {
          const k = keyFor(it);
          if (!seen.has(k)) {
            next.push(it);
            seen.add(k);
          }
        }
        for (const it of s) {
          const k = keyFor(it);
          if (!seen.has(k)) {
            next.push(it);
            seen.add(k);
          }
        }
        return next; // 🚫 no sort here
      });
    } finally {
      if (myLoad === loadId.current) setLoadingPage(false);
    }
  }

  function toggleSelect(it: GridItem) {
    const k = keyFor(it);
    setSelected(prev => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = { mediaId: it.id, mediaType: it.mediaType, title: it.title, posterPath: it.posterUrl ?? null };
      return next;
    });
  }

  async function handleSave() {
    if (!uid || !title.trim()) return;
    setSaving(true);
    const payload = Object.values(selected).map(v => ({ ...v, backdropPath: null }));
    try {
      if (mode === "create") {
        await createCollectionWithItems(uid, title.trim(), payload, { style, pinnedToHome });
      } else {
        if (!collectionId) throw new Error("Missing collectionId for edit");
        await updateCollectionMeta(uid, collectionId, { title: title.trim(), style, pinnedToHome });
        await upsertCollectionItems(uid, collectionId, payload);
      }
      toast({ title: mode === "create" ? "Collection created" : "Collection updated" });
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Hydrate on open
  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && collectionId) {
      setLoadingEdit(true);
      (async () => {
        const meta = await getCollection(uid, collectionId);
        const items = await getCollectionItemsOrdered(uid, collectionId);
        setTitle(meta.title ?? "");
        setStyle(meta.style ?? "vertical-posters-small");
        setPinnedToHome(!!meta.pinnedToHome);
        const pre: Record<string, any> = {};
        items.forEach((it:any) => {
          const bucket = it.mediaType === "movie" ? "movies" : "shows";
          pre[`${bucket}:${it.mediaId}`] = {
            mediaId: it.mediaId,
            mediaType: it.mediaType,
            title: it.title,
            posterPath: it.posterPath ?? null,
            backdropPath: it.backdropPath ?? null,
          };
        });
        setSelected(pre);
        setLoadingEdit(false);
      })();
    } else {
      setTitle(initialTitle);
      setStyle(initialStyle);
      setPinnedToHome(initialPinnedToHome);
      const pre: Record<string, any> = {};
      initialSelected.forEach(it => {
        const bucket = it.mediaType === "movie" ? "movies" : "shows";
        pre[`${bucket}:${it.mediaId}`] = it;
      });
      setSelected(pre);
    }

    resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid, mode, collectionId]);

  // Reset paging on filter change (keeps selections)
  useEffect(() => {
    if (open) resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // IntersectionObserver for infinite scroll (root = ScrollArea viewport)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      const viewport = sentinel.closest("[data-radix-scroll-area-viewport]") || undefined;
      const io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting && canLoadMore) void loadNextPage();
        },
        { root: (viewport as Element) ?? null, rootMargin: "800px", threshold: 0 }
      );
      io.observe(sentinel);
      return () => io.disconnect();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canLoadMore]);

  return (
    <Dialog open={open} onOpenChange={(v)=>!saving && onOpenChange(v)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Collection" : "New Collection"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-6">
          {/* LEFT */}
          <div className="col-span-12 md:col-span-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="coll-name">Collection name</Label>
              <Input id="coll-name" value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="e.g., Cozy Fall Movies" />
            </div>

            <div className="space-y-2">
              <Label>Media Type</Label>
              <Select value={filter} onValueChange={(v)=>setFilter(v as MediaFilter)}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="movie">Movies</SelectItem>
                  <SelectItem value="show">Shows</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Collection style</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger><SelectValue placeholder="Select a style" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical-posters-small">Vertical Posters (Small)</SelectItem>
                  <SelectItem value="vertical-posters-large">Vertical Posters (Large)</SelectItem>
                  <SelectItem value="horizontal-posters-large">Horizontal Posters (Large)</SelectItem>
                  <SelectItem value="horizontal-posters-small">Horizontal Posters (Small)</SelectItem>
                  <SelectItem value="horizontal-poster-featured">Horizontal Posters (Featured)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Add to Home Dashboard?</div>
                <div className="text-xs text-muted-foreground">Pin this collection as a row on Home.</div>
              </div>
              <Switch checked={pinnedToHome} onCheckedChange={setPinnedToHome} />
            </div>

            <div className="text-xs text-muted-foreground">
              Selected: <span className="font-medium">{selectedCount}</span>
            </div>
          </div>

          {/* RIGHT */}
          <div className="col-span-12 md:col-span-8">
            <ScrollArea className="h-[65vh] rounded-2xl border">
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredToRender.map((m) => {
                  const k = keyFor(m);
                  const isSelected = !!selected[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleSelect(m)}
                      className="relative h-48 w-full rounded-xl overflow-hidden bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                      title={`${m.title} • ${m.mediaType}`}
                    >
                      {m.posterUrl ? (
                        <Image src={m.posterUrl} alt={m.title} fill className="object-cover" sizes="180px" />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-[10px] text-muted-foreground">No poster</div>
                      )}
                      <div className={`absolute inset-0 transition ${isSelected ? "ring-2 ring-primary" : "ring-0"}`} />
                      {isSelected && (
                        <div className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* autoload sentinel */}
              {canLoadMore && <div ref={sentinelRef} className="h-10" />}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={()=>onOpenChange(false)} disabled={saving || loadingEdit}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loadingEdit || !title.trim() || selectedCount===0}>
            {mode === "edit" ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewCollectionModal;
