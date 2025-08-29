
import Link from 'next/link';
import Image from 'next/image';
import type { MediaItem } from '@/lib/types';
import { WatchlistButton } from './watchlist-button';
import { Star } from 'lucide-react';

interface MediaCardProps {
  item: MediaItem;
}

export function MediaCard({ item }: MediaCardProps) {
  return (
    <Link href={`/media/${item.id}`} className="group block" prefetch={false}>
      <div className="flex flex-col gap-2">
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40">
          <Image
            src={item.poster_path}
            alt={item.title}
            width={500}
            height={750}
            className="object-cover"
            data-ai-hint={`${item.media_type} poster`}
          />
          <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <WatchlistButton item={item} asIcon />
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="font-headline text-base font-bold text-foreground truncate">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{new Date(item.release_date).getFullYear()}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
