
'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import Image from 'next/image';

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
            <CarouselItem key={index} className="pl-4 basis-1/3 sm:basis-1/4 md:basis-1/5 lg:basis-1/6 xl:basis-1/7">
              <div className="group">
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg">
                    {member.profileUrl ? (
                        <Image
                            src={member.profileUrl}
                            alt={member.name}
                            fill
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                            <Avatar className="h-24 w-24">
                                <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                        </div>
                    )}
                </div>
                <div className="space-y-1 mt-2 text-center">
                  <p className="font-bold text-sm">{member.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{member.character}</p>
                  <p className="text-xs text-muted-foreground">8 Episodes</p>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
