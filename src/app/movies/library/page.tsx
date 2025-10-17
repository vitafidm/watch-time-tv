
"use client"

import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, RefreshCw } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { WatchlistButton } from "@/components/watchlist-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInfiniteFirestore } from "@/hooks/useInfiniteFirestore";
import { MediaEditButton } from "@/components/MediaEditButton";
import { MediaEditModal, type MediaEditModalItem } from "@/components/MediaEditModal";
import { PlayButton } from "@/components/PlayButton";
import { PlayerDialog } from "@/components/PlayerDialog";

function getInitials(title: string = ""): string {
  return title
    .split(' ')
    .map(word => word[0])
    .filter(char => /[a-zA-Z0-9]/.test(char))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}


// A version of MediaCard that works with MediaDoc from Firestore
function MediaDocCard({ item, onEdit, onPlay }: { item: MediaDoc & {id: string}, onEdit: () => void; onPlay: () => void; }) {
    const displayTitle = item.normalizedTitle || item.title;

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
        
        return {
            id: item.tmdbId || Math.random(), // Fallback id
            title: displayTitle,
            overview: (item as any).overview || '',
            poster_path: item.posterUrl || '', // Prioritize posterUrl, fallback handled in JSX
            backdrop_path: item.backdropUrl || `https://picsum.photos/1280/720?random=${item.mediaId}`,
            release_date: releaseDate,
            vote_average: (item as any).vote_average || 0,
            genres: (item as any).genres || [],
            media_type: item.type,
        };
    }, [item, displayTitle]);
    
    return (
        <div className="group block" data-testid="movie-card">
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40 bg-muted">
                <Link href={`/media/${item.mediaId}`} prefetch={false} className="block w-full h-full">
                    {mediaItem.poster_path ? (
                        <Image
                            src={mediaItem.poster_path}
                            alt={mediaItem.title}
                            width={500}
                            height={750}
                            className="object-cover"
                            data-ai-hint={`${item.type} poster`}
                        />
                    ) : (
                         <div className="w-full h-full flex items-center justify-center bg-secondary">
                            <span className="font-headline text-4xl text-muted-foreground">{getInitials(displayTitle)}</span>
                        </div>
                    )}
                </Link>
                <div className="absolute top-2 right-11 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <WatchlistButton item={mediaItem} asIcon />
                </div>
                <MediaEditButton onOpen={onEdit} />
                <PlayButton
                  onClick={onPlay}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                />
            </div>
            <div className="space-y-1 mt-2">
            <h3 className="font-headline text-base font-bold text-foreground truncate" title={displayTitle}>
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
  const { toast } = useToast();
  
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { items: fetchedMovies, loading, hasMore, attachSentinel, resetAndFetch } = useInfiniteFirestore<MediaDoc & {id: string}>({
    collectionPath: user ? `users/${user.uid}/media` : undefined,
    where: [['type', '==', 'movie']],
    orderBy: ['addedAt', 'desc'],
    pageSize: 24,
    map: (doc) => ({ id: doc.id, ...doc.data() } as MediaDoc & {id: string}),
  });

  const [movies, setMovies] = useState<Array<MediaDoc & {id: string}>>([]);
  useEffect(() => {
    setMovies(fetchedMovies);
  }, [fetchedMovies]);

  
  const [editingItem, setEditingItem] = useState<MediaEditModalItem | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(undefined);


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
            normalizedTitle: item.normalizedTitle,
            posterUrl: item.posterUrl,
        }
    });
  };
  
  const handleApplied = (id: string, patch: Partial<MediaDoc>) => {
    setMovies(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  };
  
  const handleRefresh = async () => {
    if (!resetAndFetch) return;
    setIsRefreshing(true);
    try {
      await resetAndFetch();
      toast({ title: "Library refreshed" });
    } catch (error: any) {
      console.error("Failed to refresh library:", error);
      toast({ title: "Refresh failed", description: error.message, variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  };


  const showInitialLoading = loading && movies.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
            <Film className="h-8 w-8 text-primary" />
            <h1 className="font-headline text-4xl font-bold tracking-tight">Movie Library</h1>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing || loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6" data-testid="movies-grid">
          {movies.map(item => (
            <MediaDocCard key={item.id} item={item} onEdit={() => handleEdit(item)} onPlay={() => { setSelectedMediaId(item.mediaId); setSelectedTitle(item.title); setOpen(true); }}/>
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
        onApplied={handleApplied}
      />
      <PlayerDialog open={open} onOpenChange={setOpen} mediaId={selectedMediaId} title={selectedTitle} />
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
