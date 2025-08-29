"use client"

import { Bookmark } from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { useWatchlist } from '@/hooks/use-watchlist';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WatchlistButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  item: MediaItem;
  asIcon?: boolean;
}

export function WatchlistButton({ item, asIcon = false, className, ...props }: WatchlistButtonProps) {
  const { isOnWatchlist, addToWatchlist, removeFromWatchlist } = useWatchlist();
  const onList = isOnWatchlist(item.id);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onList) {
      removeFromWatchlist(item.id);
    } else {
      addToWatchlist(item);
    }
  };

  if (asIcon) {
     return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        className={cn("rounded-full h-10 w-10 bg-background/50 backdrop-blur-sm hover:bg-background/75", className)}
        aria-label={onList ? 'Remove from watchlist' : 'Add to watchlist'}
        {...props}
      >
        <Bookmark className={cn("h-5 w-5", onList ? "text-primary fill-primary" : "text-foreground")} />
      </Button>
    )
  }

  return (
    <Button
      variant={onList ? "secondary" : "default"}
      onClick={handleToggle}
      className={className}
      {...props}
    >
      <Bookmark className={cn("mr-2 h-4 w-4", onList && "fill-current")} />
      {onList ? 'On Watchlist' : 'Add to Watchlist'}
    </Button>
  );
}
