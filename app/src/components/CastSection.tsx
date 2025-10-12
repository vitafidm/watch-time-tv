'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';

interface CastMember {
  name: string;
  character: string;
  profileUrl: string | null;
}

interface CastSectionProps {
  cast?: CastMember[];
}

export function CastSection({ cast }: CastSectionProps) {
  if (!cast || cast.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="font-headline text-3xl font-bold tracking-tight">Cast & Crew</h2>
      <Carousel
        opts={{
          align: 'start',
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {cast.map((member, index) => (
            <CarouselItem key={index} className="pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5">
              <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-2">
                <Avatar className="h-20 w-16 rounded-md border-0">
                  <AvatarImage src={member.profileUrl ?? undefined} alt={member.name} />
                  <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-bold text-sm">{member.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{member.character}</p>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
