
"use client"

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, Sparkles, RefreshCw } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { WatchlistButton } from "@/components/watchlist-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ENV } from "@/lib/env";
import { useInfiniteFirestore } from "@/hooks/useInfiniteFirestore";
import { cleanMovieTitle } from "@/lib/movieTitle";
import { MediaEditButton } from "@/components/MediaEditButton";
import { MediaEditModal, type MediaEditModalItem } from "@/components/MediaEditModal";

// A version of MediaCard that works with MediaDoc from Firestore
function MediaDocCard({ item, onEdit }: { item: MediaDoc & {id: string}, onEdit: () => void; }) {
    const displayTitle = useMemo(() => cleanMovieTitle(item as any), [item]);

    const mediaItem = useMemo(() => {
        // Safely determine the release date, handling both Timestamp objects and ISO strings.
        let releaseDate = new Date().toISOString();
        if (item.addedAt) {
            if (typeof (item.addedAt as any).toDate === 'function') {
                releaseDate = (item.addedAt as any).toDate().toISOString();
            } else if (typeof item.addedAt === 'string') {
                const d = new Date(item.addedAt);
                if (!isNaN(d.getTime())) {
                    releaseDate = d.toISOString();
                }
            }
        }
        
        const poster = item.posterUrl || ((item as any).poster_path ? `https://image.tmdb.org/t/p/w500${(item as any).poster_path}` : `https://picsum.photos/seed/${item.id}/500/750`);

        return {
            id: item.tmdbId || Math.random(), // Fallback id
            title: item.title,
            overview: (item as any).overview || '',
            poster_path: poster,
            backdrop_path: item.backdropUrl || `https://picsum.photos/1280/720?random=${item.mediaId}`,
            release_date: releaseDate,
            vote_average: (item as any).vote_average || 0,
            genres: (item as any).genres || [],
            media_type: item.type,
        };
    }, [item]);
    
    return (
        <div className="group block">
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40">
                <Link href={`/media/${item.mediaId}`} prefetch={false} className="block w-full h-full">
                    <Image
                        src={mediaItem.poster_path}
                        alt={mediaItem.title}
                        width={500}
                        height={750}
                        className="object-cover bg-muted"
                        data-ai-hint={`${item.type} poster`}
                    />
                </Link>
                <div className="absolute top-2 right-11 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <WatchlistButton item={mediaItem} asIcon />
                </div>
                <MediaEditButton onOpen={onEdit} />
            </div>
            <div className="space-y-1 mt-2">
            <h3 className="font-headline text-base font-bold text-foreground truncate">
                {displayTitle}
            </h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{item.year || new Date(mediaItem.release_date).getFullYear()}</span>
            </div>
            </div>
        </div>
    );
}

function MovieLibrary() {
  const { user } = useAuthUser();
  const { items: movies, loading, hasMore, attachSentinel, reset } = useInfiniteFirestore<MediaDoc & {id: string}>({
    collectionPath: user ? `users/${user.uid}/media` : undefined,
    where: [['type', '==', 'movie']],
    orderBy: ['addedAt', 'desc'],
    pageSize: 24,
    map: (doc) => ({ id: doc.id, ...doc.data() } as MediaDoc & {id: string}),
  });

  const { toast } = useToast();
  const [isEnriching, setIsEnriching] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaEditModalItem | null>(null);

  const sentinelRef = useRef(null);
  attachSentinel(sentinelRef.current);

  const handleEdit = (item: MediaDoc & {id: string}) => {
    if (!user) return;
    setEditingItem({
        id: item.id,
        collectionPath: `users/${user.uid}/media`,
        kind: 'movie',
        current: {
            title: item.title,
            posterUrl: item.posterUrl,
        }
    });
  };

  const handleEnrich = useCallback(async () => {
    if (!user || !movies || movies.length === 0 || !ENV.TMDB_ENRICH_URL) {
        toast({ title: "Error", description: "Cannot enrich. User not signed in, library is empty, or enrich URL is not configured.", variant: "destructive" });
        return;
    }
    setIsEnriching(true);
    toast({ title: "Starting Enrichment", description: "Fetching metadata from TMDB for your movie library..." });

    try {
        const idToken = await user.getIdToken();
        const itemsToEnrich = movies.map(m => ({
            mediaId: m.id,
            type: m.type,
            title: m.title,
            year: m.year,
        }));
        
        const response = await fetch(ENV.TMDB_ENRICH_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${idToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ items: itemsToEnrich }),
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.error?.message || "Failed to enrich metadata.");
        }

        const enrichedCount = result.results?.filter((r: any) => r.status === 'enriched').length || 0;
        toast({ title: "Enrichment Complete", description: `Successfully updated metadata for ${enrichedCount} movies.` });
        if (enrichedCount > 0) reset();

    } catch (err: any) {
        console.error("Enrichment failed:", err);
        toast({ title: "Enrichment Failed", description: err.message, variant: "destructive"});
    } finally {
        setIsEnriching(false);
    }
  }, [user, movies, toast, reset]);

  const showInitialLoading = loading && movies.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
            <Film className="h-8 w-8 text-primary" />
            <h1 className="font-headline text-4xl font-bold tracking-tight">Movie Library</h1>
        </div>
        <Button onClick={handleEnrich} disabled={isEnriching || movies.length === 0}>
            {isEnriching ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {isEnriching ? 'Enriching...' : 'Enrich Metadata'}
        </Button>
      </div>

      {showInitialLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
             <div key={i} className="space-y-2">
                <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!showInitialLoading && movies.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {movies.map(item => (
            <MediaDocCard key={item.id} item={item} onEdit={() => handleEdit(item)} />
          ))}
        </div>
      )}

      {!loading && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Film className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-2 text-2xl font-headline text-foreground">No Movies Found</h2>
          <p className="mt-2 text-muted-foreground">Your movie library is empty. Connect an agent to add media.</p>
        </div>
      )}

      {hasMore && <div ref={sentinelRef} className="h-10 w-full" />}
      
      <MediaEditModal 
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
      />
    </div>
  );
}

export default function MovieLibraryPage() {
    return (
        <ProtectedRoute>
            <MovieLibrary />
        </ProtectedRoute>
    )
}
