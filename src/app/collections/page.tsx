"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, GripVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import NewCollectionModal from "@/components/NewCollectionModal";
import {
  fetchCollections,
  getCollection,
  getCollectionItemsOrdered,
  deleteCollection,
  // ⭐ NEW:
  getCollectionOrder,
  saveCollectionOrder,          // (kept: item order inside a collection)
  saveCollectionPriority,       // ⭐ NEW: order of collections themselves
} from "@/lib/collections";

type AnyCollection = {
  id: string;
  title: string;
  style?: string;
  pinnedToHome?: boolean;
  itemCount?: number;
  createdAt?: any;
};

export default function CollectionsPage() {
  const { user, loading } = useAuthUser();
  const [rows, setRows] = useState<AnyCollection[]>([]);
  const [rowIds, setRowIds] = useState<string[]>([]);      // ⭐ NEW
  const [reordering, setReordering] = useState(false);     // ⭐ NEW
  const [savingOrder, setSavingOrder] = useState(false);   // ⭐ NEW

  const [openNew, setOpenNew] = useState(false);

  // EDIT modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<{
    id: string;
    initialTitle: string;
    initialStyle: string;
    initialPinnedToHome: boolean;
    initialSelected: Array<{ mediaId: string; mediaType: "movie" | "show"; title: string; posterPath?: string | null }>;
  } | null>(null);

  // Sensors: quick mouse, slight long-press on touch
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      const [data, order] = await Promise.all([
        fetchCollections(user.uid),
        getCollectionOrder(user.uid),  // ⭐ NEW
      ]);

      // Sort collections by saved order; unknowns go after (by createdAt desc if present)
      const orderMap = new Map<string, number>();
      (order ?? []).forEach((id, idx) => orderMap.set(id, idx));

      const withIndex = (data as AnyCollection[]).map((c) => ({
        ...c,
        __idx: orderMap.has(c.id) ? orderMap.get(c.id)! : Number.POSITIVE_INFINITY,
      }));

      withIndex.sort((a, b) => {
        if (a.__idx !== b.__idx) return a.__idx - b.__idx;
        // fallback: newest first if createdAt exists
        const aTs = (a.createdAt?.toMillis?.() ?? 0) as number;
        const bTs = (b.createdAt?.toMillis?.() ?? 0) as number;
        return bTs - aTs;
      });

      setRows(withIndex);
      setRowIds(withIndex.map((c) => c.id));
    })();
  }, [user?.uid]);

  async function refresh() {
    if (!user?.uid) return;
    const data = await fetchCollections(user.uid);
    // keep current order where possible
    const order = rowIds.length ? rowIds : (await getCollectionOrder(user.uid)) ?? [];
    const orderSet = new Set(order);
    const known = data.filter((c: AnyCollection) => orderSet.has(c.id));
    const unknown = data.filter((c: AnyCollection) => !orderSet.has(c.id));
    // unknowns at end
    const ordered = [
      ...order.map((id) => known.find((c: AnyCollection) => c.id === id)).filter(Boolean),
      ...unknown,
    ] as AnyCollection[];

    setRows(ordered);
    setRowIds(ordered.map((c) => c.id));
  }

  async function openEdit(collectionId: string) {
    if (!user?.uid) return;
    const meta = await getCollection(user.uid, collectionId);
    const items = await getCollectionItemsOrdered(user.uid, collectionId);
    setEditState({
      id: collectionId,
      initialTitle: meta.title ?? "",
      initialStyle: meta.style ?? "poster-grid",
      initialPinnedToHome: !!meta.pinnedToHome,
      initialSelected: items.map((it: any) => ({
        mediaId: it.mediaId,
        mediaType: it.mediaType,
        title: it.title,
        posterPath: it.posterPath ?? null,
      })),
    });
    setEditOpen(true);
  }

  // ⭐ NEW: drag end for ROWS (collections)
  async function handleRowDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over || active.id === over.id) return;

    const oldIndex = rowIds.indexOf(String(active.id));
    const newIndex = rowIds.indexOf(String(over.id));
    const nextIds = arrayMove(rowIds, oldIndex, newIndex);

    // update UI
    setRowIds(nextIds);
    setRows((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      return nextIds.map((id) => map.get(id)!).filter(Boolean);
    });

    // persist
    setSavingOrder(true);
    try {
      await saveCollectionPriority(user!.uid, nextIds);
    } finally {
      setSavingOrder(false);
    }
  }

  return (
    <ProtectedRoute loading={loading}>
      <div className="px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Collections</h1>
          <div className="flex items-center gap-2">
            {/* ⭐ NEW: toggle row reordering */}
            <Button
              variant={reordering ? "secondary" : "ghost"}
              onClick={() => setReordering((v) => !v)}
            >
              {reordering ? "Done" : "Reorder Collections"}
            </Button>
            <Button onClick={() => setOpenNew(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Collection
            </Button>
          </div>
        </div>

        {/* ⭐ NEW: DnD for collection ROWS */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
          <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {rows.map((c) => (
                <SortableCollectionRow
                  key={c.id}
                  id={c.id}
                  disabled={!reordering}
                >
                  <CollectionRow
                    uid={user!.uid}
                    collection={c}
                    onChanged={refresh}
                    onEdit={() => openEdit(c.id)}
                    // pass a small reorder affordance
                    reorderHandle={reordering}
                  />
                </SortableCollectionRow>
              ))}

              {rows.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No collections yet. Create your first one.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>

        {savingOrder && (
          <div className="text-xs text-muted-foreground">Saving order…</div>
        )}

        {/* CREATE modal */}
        <NewCollectionModal
          open={openNew}
          onOpenChange={setOpenNew}
          uid={user?.uid ?? ""}
          mode="create"
          onSaved={refresh}
        />

        {/* EDIT modal */}
        <NewCollectionModal
          open={editOpen}
          onOpenChange={setEditOpen}
          uid={user?.uid ?? ""}
          mode="edit"
          collectionId={editState?.id}
          initialTitle={editState?.initialTitle}
          initialStyle={editState?.initialStyle}
          initialPinnedToHome={editState?.initialPinnedToHome}
          initialSelected={editState?.initialSelected ?? []}
          onSaved={refresh}
        />
      </div>
    </ProtectedRoute>
  );
}

/** ----------------------------------------------
 * Sortable wrapper for a whole collection row  ⭐ NEW
 * ---------------------------------------------- */
function SortableCollectionRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "rounded-2xl border bg-card",
        isDragging ? "ring-2 ring-primary shadow-lg" : "",
      ].join(" ")}
      {...(!disabled ? { ...attributes, ...listeners } : {})}
    >
      {children}
    </div>
  );
}

/** ----------------------------------------------
 * A single row: title + horizontal scroll of items
 * (unchanged, minus its own outer border—now provided by Sortable wrapper)
 * ---------------------------------------------- */
function CollectionRow({
  uid,
  collection,
  onChanged,
  onEdit,
  reorderHandle = false, // ⭐ NEW: show grip when reordering
}: {
  uid: string;
  collection: AnyCollection;
  onChanged: () => void;
  onEdit: () => void;
  reorderHandle?: boolean;
}) {
  const [items, setItems] = useState<Array<{ id: string; title: string; posterPath?: string | null }>>([]);
  const [reordering, setReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  useEffect(() => {
    (async () => {
      const docs = await getCollectionItemsOrdered(uid, collection.id);
      setItems(
        docs.map((d: any) => ({
          id: d.id, // collection item doc id
          title: d.title,
          posterPath: d.posterPath ?? null,
        }))
      );
    })();
  }, [uid, collection.id]);

  // Sensors already created above for the page-level DnD

  async function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const newArr = arrayMove(items, oldIndex, newIndex);
    setItems(newArr);
    setSavingOrder(true);
    try {
      await saveCollectionOrder(uid, collection.id, newArr.map((i) => i.id));
    } finally {
      setSavingOrder(false);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* ⭐ NEW: grip appears when row-reordering is enabled */}
          {reorderHandle && (
            <span className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground">
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <div className="text-base font-medium">{collection.title}</div>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle reorder of ITEMS within this collection */}
          <Button
            variant={reordering ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setReordering((v) => !v)}
          >
            {reordering ? "Done" : "Reorder Items"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>Edit Collection</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={async () => {
                  await deleteCollection(uid, collection.id);
                  onChanged();
                }}
              >
                Delete Collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* DND context for ITEMS within a collection */}
      <DndContext sensors={useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }))} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {items.map((it) => (
              <SortablePoster
                key={it.id}
                id={it.id}
                title={it.title}
                posterPath={it.posterPath}
                disabled={!reordering}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {savingOrder && <div className="mt-2 text-xs text-muted-foreground">Saving order…</div>}
    </div>
  );
}

function SortablePoster({
  id,
  title,
  posterPath,
  disabled,
}: {
  id: string;
  title: string;
  posterPath?: string | null;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative h-40 w-28 shrink-0 overflow-hidden rounded-xl ${isDragging ? "ring-2 ring-primary" : "bg-muted"}`}
      title={title}
      {...(!disabled ? { ...attributes, ...listeners } : {})}
    >
      {posterPath ? (
        <Image src={posterPath} alt={title} fill className="object-cover" sizes="112px" />
      ) : (
        <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">Poster</div>
      )}
    </div>
  );
}
