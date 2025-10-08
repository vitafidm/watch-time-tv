'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';

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
            <CarouselItem key={index} className="pl-4 basis-1/4 sm:basis-1/5 md:basis-1/6 lg:basis-1/8">
              <div className="flex flex-col items-center text-center gap-2">
                <Avatar className="h-24 w-24 border-2 border-transparent group-hover:border-primary transition-colors">
                  <AvatarImage src={member.profileUrl ?? undefined} alt={member.name} />
                  <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="space-y-0.5">
                  <p className="font-bold text-sm leading-tight">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.character}</p>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex" />
        <CarouselNext className="hidden md:flex" />
      </Carousel>
    </div>
  );
}
