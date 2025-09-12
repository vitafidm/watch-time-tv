
"use client"

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Tv } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useRef, useState, useEffect } from "react";
import Image from "next/image";
import { useInfiniteFirestore } from "@/hooks/useInfiniteFirestore";
import { MediaEditButton } from "@/components/MediaEditButton";
import { MediaEditModal, type MediaEditModalItem } from "@/components/MediaEditModal";

// Represents a document from the /users/{uid}/shows collection
type ShowDoc = {
    id: string;
    tmdbShowId: number;
    title: string;
    displayTitle?: string;
    posterUrl?: string;
    backdropUrl?: string;
    videoLink?: string;
    episodeCount?: number;
    updatedAt: any; // Firestore Timestamp
};

function ShowCard({ item, onEdit }: { item: ShowDoc, onEdit: () => void; }) {
    const displayTitle = item.displayTitle || item.title;

    return (
        <div role="button" aria-disabled="true" className="group block">
            <div className="flex flex-col gap-2">
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40">
                    <Image
                        src={item.posterUrl || `https://picsum.photos/500/750?random=${item.id}`}
                        alt={displayTitle}
                        width={500}
                        height={750}
                        className="object-cover bg-muted"
                        data-ai-hint="tv show poster"
                    />
                    <MediaEditButton onOpen={onEdit} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-headline text-base font-bold text-foreground truncate">
                      {displayTitle}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.episodeCount || 0} {item.episodeCount === 1 ? 'episode' : 'episodes'}</span>
                  </div>
                </div>
            </div>
        </div>
    );
}

function TvLibrary() {
  const { user } = useAuthUser();
  const { items: fetchedShows, loading, hasMore, attachSentinel } = useInfiniteFirestore<ShowDoc>({
      collectionPath: user ? `users/${user.uid}/shows` : undefined,
      where: [['episodeCount', '>', 0]],
      orderBy: ['updatedAt', 'desc'],
      pageSize: 24,
      map: (doc) => ({ id: doc.id, ...doc.data() } as ShowDoc),
  });

  const [shows, setShows] = useState<ShowDoc[]>([]);
  useEffect(() => {
    setShows(fetchedShows);
  }, [fetchedShows]);

  const [editingItem, setEditingItem] = useState<MediaEditModalItem | null>(null);

  const handleEdit = (show: ShowDoc) => {
    if (!user) return;
    setEditingItem({
        id: String(show.id), // Doc ID is the tmdbShowId
        collectionPath: `users/${user.uid}/shows`,
        kind: 'show',
        current: {
            title: show.title,
            displayTitle: show.displayTitle,
            tmdbId: show.tmdbShowId,
            posterUrl: show.posterUrl,
            backdropUrl: show.backdropUrl,
            videoLink: show.videoLink,
        }
    });
  };

  const handleApplied = (id: string, patch: Partial<ShowDoc>) => {
    setShows(prev =>
        prev.map(s => String(s.id) === id ? { ...s, ...patch } : s)
    );
  };

  const sentinelRef = useRef(null);
  attachSentinel(sentinelRef.current);

  const showInitialLoading = loading && shows.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Tv className="h-8 w-8 text-primary" />
        <h1 className="font-headline text-4xl font-bold tracking-tight">TV Library</h1>
      </div>

      {showInitialLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {Array.from({ length: 18 }).map((_, i) => (
             <div key={i} className="space-y-2">
                <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!showInitialLoading && shows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {shows.map(item => (
            <ShowCard key={item.id} item={item} onEdit={() => handleEdit(item)} />
          ))}
        </div>
      )}

      {!loading && shows.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Tv className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-6 text-2xl font-headline text-foreground">No TV Shows Found</h2>
          <p className="mt-2 text-muted-foreground">Your TV library is empty. Connect an agent to add media or run the materializer function.</p>
        </div>
      )}
      
      {hasMore && <div ref={sentinelRef} className="h-10 w-full" />}
      
      <MediaEditModal 
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onApplied={handleApplied}
      />
    </div>
  );
}

export default function TvLibraryPage() {
    return (
        <ProtectedRoute>
            <TvLibrary />
        </ProtectedRoute>
    )
}
