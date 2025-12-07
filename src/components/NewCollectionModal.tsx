// src/components/NewCollectionModal.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  createCollectionWithItems,
  UserCollectionItem,
  getCollection,
  getCollectionItemsOrdered,
  updateCollectionMeta,
  upsertCollectionItems,
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
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // Selection
  const [selected, setSelected] = useState<
    Record<string, Omit<UserCollectionItem, "order" | "addedAt">>
  >({});

  // Grid data (no paging; we load everything once per open)
  const [items, setItems] = useState<GridItem[]>([]);

  const loadId = useRef(0);

  const keyFor = (it: GridItem) => `${it._bucket}:${it.id}`;
  const selectedCount = Object.keys(selected).length;

  // View filter is derived; underlying `items` is already A→Z
  const filteredToRender = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter((i) =>
            filter === "movie" ? i.mediaType === "movie" : i.mediaType === "show"
          ),
    [items, filter]
  );

  // --- Load full library once per open ---
  async function loadAllMedia() {
    if (!uid) return;
    const myLoad = ++loadId.current;
    setLoadingLibrary(true);

    try {
      const [moviesSnap, showsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "users", uid, "media"),
            where("tmdbType", "==", "movie")
          )
        ),
        getDocs(
          query(
            collection(db, "users", uid, "shows"),
            where("tmdbType", "==", "tv")
          )
        ),
      ]);

      const movies: GridItem[] = moviesSnap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          mediaType: "movie" as const,
          title: x.title ?? x.name ?? "Untitled",
          posterUrl: x.posterUrl ?? null,
          year: x.year ?? x.releaseYear,
          _bucket: "movies" as const,
        };
      });

      const shows: GridItem[] = showsSnap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          mediaType: "show" as const,
          title: x.title ?? x.name ?? "Untitled",
          posterUrl: x.posterUrl ?? null,
          year: x.year ?? x.firstAirYear,
          _bucket: "shows" as const,
        };
      });

      // If another open/close cycle happened, ignore this load
      if (myLoad !== loadId.current) return;

      // ✅ Single in-memory A→Z sort by title (case-insensitive)
      const all = [...movies, ...shows].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      );

      setItems(all);
    } finally {
      if (myLoad === loadId.current) setLoadingLibrary(false);
    }
  }

  function toggleSelect(it: GridItem) {
    const k = keyFor(it);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else
        next[k] = {
          mediaId: it.id,
          mediaType: it.mediaType,
          title: it.title,
          posterPath: it.posterUrl ?? null,
        };
      return next;
    });
  }

  async function handleSave() {
    if (!uid || !title.trim()) return;
    setSaving(true);
    const payload = Object.values(selected).map((v) => ({
      ...v,
      backdropPath: null,
    }));
    try {
      if (mode === "create") {
        await createCollectionWithItems(uid, title.trim(), payload, {
          style,
          pinnedToHome,
        });
      } else {
        if (!collectionId) throw new Error("Missing collectionId for edit");
        await updateCollectionMeta(uid, collectionId, {
          title: title.trim(),
          style,
          pinnedToHome,
        });
        await upsertCollectionItems(uid, collectionId, payload);
      }
      toast({
        title:
          mode === "create"
            ? "Collection created"
            : "Collection updated",
      });
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Hydrate on open (meta + selection + full library)
  useEffect(() => {
    if (!open) return;

    // reset local state that depends on initial props
    if (mode === "edit" && collectionId) {
      setLoadingEdit(true);
      (async () => {
        try {
          const meta = await getCollection(uid, collectionId);
          const items = await getCollectionItemsOrdered(uid, collectionId);
          setTitle(meta.title ?? "");
          setStyle(meta.style ?? "vertical-posters-small");
          setPinnedToHome(!!meta.pinnedToHome);
          const pre: Record<string, any> = {};
          items.forEach((it: any) => {
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
        } finally {
          setLoadingEdit(false);
        }
      })();
    } else {
      setTitle(initialTitle);
      setStyle(initialStyle);
      setPinnedToHome(initialPinnedToHome);
      const pre: Record<string, any> = {};
      initialSelected.forEach((it) => {
        const bucket = it.mediaType === "movie" ? "movies" : "shows";
        pre[`${bucket}:${it.mediaId}`] = it;
      });
      setSelected(pre);
    }

    // Load entire movie + show library alphabetically
    setItems([]);
    void loadAllMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid, mode, collectionId]);

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Collection" : "New Collection"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-6">
          {/* LEFT */}
          <div className="col-span-12 md:col-span-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="coll-name">Collection name</Label>
              <Input
                id="coll-name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Cozy Fall Movies"
              />
            </div>

            <div className="space-y-2">
              <Label>Media Type</Label>
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v as MediaFilter)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue placeholder="Select a style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical-posters-small">
                    Vertical Posters (Small)
                  </SelectItem>
                  <SelectItem value="vertical-posters-large">
                    Vertical Posters (Large)
                  </SelectItem>
                  <SelectItem value="horizontal-posters-large">
                    Horizontal Posters (Large)
                  </SelectItem>
                  <SelectItem value="horizontal-posters-small">
                    Horizontal Posters (Small)
                  </SelectItem>
                  <SelectItem value="horizontal-poster-featured">
                    Horizontal Posters (Featured)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  Add to Home Dashboard?
                </div>
                <div className="text-xs text-muted-foreground">
                  Pin this collection as a row on Home.
                </div>
              </div>
              <Switch
                checked={pinnedToHome}
                onCheckedChange={setPinnedToHome}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Selected:{" "}
              <span className="font-medium">{selectedCount}</span>
              {loadingLibrary && (
                <span className="ml-2 italic">(Loading library…)</span>
              )}
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
                        <Image
                          src={m.posterUrl}
                          alt={m.title}
                          fill
                          className="object-cover"
                          sizes="180px"
                        />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-[10px] text-muted-foreground">
                          No poster
                        </div>
                      )}
                      <div
                        className={`absolute inset-0 transition ${
                          isSelected ? "ring-2 ring-primary" : "ring-0"
                        }`}
                      />
                      {isSelected && (
                        <div className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </button>
                  );
                })}

                {filteredToRender.length === 0 && !loadingLibrary && (
                  <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
                    No media found for this filter.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving || loadingEdit}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              saving || loadingEdit || !title.trim() || selectedCount === 0
            }
          >
            {mode === "edit" ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewCollectionModal;
