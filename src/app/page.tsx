"use client"

import { useState, useEffect, useMemo } from 'react';
import { mediaData } from '@/lib/mock-data';
import type { MediaItem } from '@/lib/types';
import { useSearch } from '@/hooks/use-search';
import { MediaCarousel } from '@/components/media-carousel';

export default function BrowsePage() {
  const { searchTerm } = useSearch();

  const [movies, tvShows] = useMemo(() => {
    const movies = mediaData.filter(item => item.media_type === 'movie');
    const tvShows = mediaData.filter(item => item.media_type === 'tv');
    return [movies, tvShows];
  }, []);

  const [filteredMovies, setFilteredMovies] = useState<MediaItem[]>(movies);
  const [filteredTvShows, setFilteredTvShows] = useState<MediaItem[]>(tvShows);

  useEffect(() => {
    const lowercasedSearchTerm = searchTerm.toLowerCase();
    setFilteredMovies(
      movies.filter(item =>
        item.title.toLowerCase().includes(lowercasedSearchTerm)
      )
    );
    setFilteredTvShows(
      tvShows.filter(item =>
        item.title.toLowerCase().includes(lowercasedSearchTerm)
      )
    );
  }, [searchTerm, movies, tvShows]);

  const hasResults = filteredMovies.length > 0 || filteredTvShows.length > 0;

  return (
    <div className="space-y-12">
      {hasResults ? (
        <>
          {filteredMovies.length > 0 && (
            <MediaCarousel title="Popular Movies" items={filteredMovies} />
          )}
          {filteredTvShows.length > 0 && (
            <MediaCarousel title="Popular TV Shows" items={filteredTvShows} />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <p className="text-2xl font-headline text-muted-foreground">No results found</p>
          <p className="mt-2 text-muted-foreground">Try adjusting your search.</p>
        </div>
      )}
    </div>
  );
}

// --- Example usage of catalog hooks (for reference only) ---
// import { useRecentlyAdded, useMediaByType, useTrending } from "@/hooks/catalog";
// import { useAuthUser } from "@/hooks/useAuthUser";
//
// export default function HomePage() {
//   const { user } = useAuthUser();
//   const uid = user?.uid || "";
//   const { data: recent, loading: loadingRecent } = useRecentlyAdded(uid, 18);
//   const { data: movies } = useMediaByType(uid, "movie", 18);
//   const { data: trending } = useTrending(uid, 18);
//
//   // Render rows using `recent`, `movies`, `trending` once user is signed in.
//   // ...
// }
