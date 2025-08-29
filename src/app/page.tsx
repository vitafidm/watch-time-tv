"use client"

import { useState, useEffect } from 'react';
import { mediaData } from '@/lib/mock-data';
import type { MediaItem } from '@/lib/types';
import { MediaCard } from '@/components/media-card';
import { useSearch } from '@/hooks/use-search';

export default function BrowsePage() {
  const [filteredMedia, setFilteredMedia] = useState<MediaItem[]>(mediaData);
  const { searchTerm } = useSearch();

  useEffect(() => {
    const results = mediaData.filter(item =>
      item.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredMedia(results);
  }, [searchTerm]);

  return (
    <div className="space-y-6">
      <h1 className="font-headline text-4xl font-bold tracking-tight">Browse Catalog</h1>
      
      {filteredMedia.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-6">
          {filteredMedia.map(item => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <p className="text-2xl font-headline text-muted-foreground">No results found</p>
          <p className="mt-2 text-muted-foreground">Try adjusting your search.</p>
        </div>
      )}
    </div>
  );
}
