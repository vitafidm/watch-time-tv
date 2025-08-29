import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import type { MediaItem } from '@/lib/types';
import { WatchlistButton } from './watchlist-button';

interface MediaCardProps {
  item: MediaItem;
}

export function MediaCard({ item }: MediaCardProps) {
  return (
    <Link href={`/media/${item.id}`} className="group block" prefetch={false}>
      <Card className="overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-1">
        <CardContent className="p-0">
          <div className="relative aspect-[2/3] w-full">
            <Image
              src={item.poster_path}
              alt={item.title}
              width={500}
              height={750}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              data-ai-hint={`${item.media_type} poster`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h3 className="font-headline text-lg font-bold text-white shadow-md truncate">
                {item.title}
              </h3>
            </div>
            <div className="absolute top-2 right-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
               <WatchlistButton item={item} asIcon />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
