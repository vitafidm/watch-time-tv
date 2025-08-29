import { notFound } from 'next/navigation';
import Image from 'next/image';
import { mediaData } from '@/lib/mock-data';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';
import { WatchlistButton } from '@/components/watchlist-button';

export default function MediaDetailPage({ params }: { params: { id: string } }) {
  const item = mediaData.find(m => m.id.toString() === params.id);

  if (!item) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div className="relative h-[40vh] md:h-[50vh] w-full -mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
        <Image
          src={item.backdrop_path}
          alt={`Backdrop for ${item.title}`}
          fill
          className="object-cover"
          priority
          data-ai-hint={`${item.media_type} backdrop`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent" />
      </div>

      <div className="container mx-auto max-w-5xl -mt-48 md:-mt-32 relative z-10">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <div className="aspect-[2/3] relative rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                <Image
                src={item.poster_path}
                alt={`Poster for ${item.title}`}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 33vw"
                data-ai-hint={`${item.media_type} poster`}
                />
            </div>
          </div>

          <div className="md:col-span-2 space-y-6 pt-8">
            <div className="space-y-2">
              <span className="text-sm font-medium text-primary">{new Date(item.release_date).getFullYear()} &bull; {item.media_type.toUpperCase()}</span>
              <h1 className="font-headline text-5xl font-bold tracking-tighter">{item.title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {item.genres.map(genre => (
                <Badge key={genre} variant="secondary">{genre}</Badge>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-yellow-400">
                <Star className="w-6 h-6 fill-current" />
                <span className="text-2xl font-bold text-foreground">{item.vote_average.toFixed(1)}</span>
              </div>
              <WatchlistButton item={item} />
            </div>

            <div>
              <h2 className="font-headline text-2xl font-bold">Overview</h2>
              <p className="mt-2 text-lg text-muted-foreground leading-relaxed">
                {item.overview}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
