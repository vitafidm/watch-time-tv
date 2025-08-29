"use client"

import { useWatchlist } from "@/hooks/use-watchlist";
import { MediaCard } from "@/components/media-card";
import { Bookmark } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WatchlistPage() {
  const { watchlist } = useWatchlist();

  return (
    <div className="space-y-6">
      <h1 className="font-headline text-4xl font-bold tracking-tight">My Watchlist</h1>
      {watchlist.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-6">
          {watchlist.map(item => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Bookmark className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-6 text-2xl font-headline text-foreground">Your watchlist is empty</h2>
          <p className="mt-2 text-muted-foreground">Add movies and shows to your watchlist to see them here.</p>
          <Button asChild className="mt-6">
            <Link href="/">Browse Media</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
