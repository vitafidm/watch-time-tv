import type { MediaItem } from '@/lib/types';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { MediaCard } from './media-card';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface MediaCarouselProps {
  title: string;
  items: MediaItem[];
  seeAllHref?: string;
}

export function MediaCarousel({ title, items, seeAllHref }: MediaCarouselProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-3xl font-bold tracking-tight">{title}</h2>
        {seeAllHref && (
          <Link href={seeAllHref} className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80">
            See All <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      <Carousel 
        opts={{
          align: "start",
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2">
          {items.map((item) => (
            <CarouselItem key={item.id} className="basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6 2xl:basis-1/7 pl-4">
               <MediaCard item={item} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex" />
        <CarouselNext className="hidden md:flex" />
      </Carousel>
    </div>
  )
}
