
"use client"

import { useMediaByType } from "@/lib/hooks/catalog";
import { useAuthUser } from "@/hooks/useAuthUser";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { Tv } from "lucide-react";
import type { MediaDoc } from "@/lib/db.types";
import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { WatchlistButton } from "@/components/watchlist-button";

// A version of MediaCard that works with MediaDoc from Firestore
function MediaDocCard({ item }: { item: MediaDoc & {id: string} }) {
    const mediaItem = useMemo(() => ({
        id: item.tmdbId || Math.random(), // Fallback id
        title: item.title,
        overview: (item as any).overview || '',
        poster_path: item.posterUrl || `https://picsum.photos/500/750?random=${item.mediaId}`,
        backdrop_path: item.backdropUrl || `https://picsum.photos/1280/720?random=${item.mediaId}`,
        release_date: item.addedAt?.toDate().toISOString() || new Date().toISOString(),
        vote_average: (item as any).vote_average || 0,
        genres: (item as any).genres || [],
        media_type: item.type,
    }), [item]);
    
    return (
        <Link href={`/media/${item.mediaId}`} className="group block" prefetch={false}>
            <div className="flex flex-col gap-2">
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40">
                <Image
                    src={mediaItem.poster_path}
                    alt={mediaItem.title}
                    width={500}
                    height={750}
                    className="object-cover bg-muted"
                    data-ai-hint={`${item.type} poster`}
                />
                <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <WatchlistButton item={mediaItem} asIcon />
                </div>
                </div>
                <div className="space-y-1">
                <h3 className="font-headline text-base font-bold text-foreground truncate">
                    {item.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.year || new Date(mediaItem.release_date).getFullYear()}</span>
                </div>
                </div>
            </div>
        </Link>
    );
}

function TvLibrary() {
  const { user } = useAuthUser();
  const { data: episodes, loading } = useMediaByType(user?.uid || "", "episode", 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Tv className="h-8 w-8 text-primary" />
        <h1 className="font-headline text-4xl font-bold tracking-tight">TV Library</h1>
      </div>

      {loading && (
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

      {!loading && episodes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
          {episodes.map(item => (
            <MediaDocCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {!loading && episodes.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Tv className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-6 text-2xl font-headline text-foreground">No TV Shows Found</h2>
          <p className="mt-2 text-muted-foreground">Your TV library is empty. Connect an agent to add media.</p>
        </div>
      )}
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
