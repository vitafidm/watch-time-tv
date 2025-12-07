// src/components/ExtraVideosSections.tsx
"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";

// --- Types -------------------------------------------------------------------

type RawExtraVideo = {
  id?: string;
  key?: string;
  name?: string | null;
  site?: string | null;
  type?: string | null; // "Trailer", "Teaser", "Clip", ...
  kind?: string | null; // alias like "trailer"
  url?: string | null;
  thumbnailUrl?: string | null;
  // optional description-ish fields if they ever exist
  overview?: string | null;
  description?: string | null;
};

interface ExtraVideosSectionsProps {
  /** Preferred prop name (movies currently use this) */
  videos?: RawExtraVideo[] | null;
  /** Backwards-compat prop name (shows may use this) */
  extras?: RawExtraVideo[] | null;
}

// --- Grouping / ordering ----------------------------------------------------

const SECTION_CONFIG = [
  {
    id: "trailers" as const,
    label: "Trailers",
    matchTypes: ["trailer", "trailers", "teaser", "teasers"],
  },
  {
    id: "clips" as const,
    label: "Clips",
    matchTypes: ["clip", "clips"],
  },
  {
    id: "behind" as const,
    label: "Behind the Scenes",
    matchTypes: [
      "behind the scenes",
      "behind_the_scenes",
      "featurette",
      "featurettes",
      "blooper",
      "bloopers",
    ],
  },
];

type SectionId = (typeof SECTION_CONFIG)[number]["id"];

type Section = {
  id: SectionId;
  label: string;
  videos: RawExtraVideo[];
};

function getYouTubeIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const regExp =
    /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  const id = match?.[1] ?? "";
  return id.length === 11 ? id : null;
}

function buildSections(rawVideos?: RawExtraVideo[] | null): Section[] {
  if (!Array.isArray(rawVideos) || rawVideos.length === 0) return [];

  const buckets: Record<SectionId, RawExtraVideo[]> = {
    trailers: [],
    clips: [],
    behind: [],
  };

  for (const v of rawVideos) {
    // 🔎 Filter out obviously-unusable entries (no YouTube id)
    const keyFromField =
      typeof v.key === "string" && v.key.trim().length === 11
        ? v.key.trim()
        : "";
    const keyFromUrl = getYouTubeIdFromUrl(v.url || undefined) || "";
    const usableKey = keyFromField || keyFromUrl;
    if (!usableKey) continue;

    const typeRaw = (v.type || v.kind || "")
      .toString()
      .toLowerCase()
      .trim();
    if (!typeRaw) continue;

    for (const cfg of SECTION_CONFIG) {
      if (cfg.matchTypes.includes(typeRaw)) {
        buckets[cfg.id].push(v);
        break;
      }
    }
  }

  return SECTION_CONFIG
    .map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      videos: buckets[cfg.id] ?? [],
    }))
    .filter((section) => section.videos.length > 0);
}

// --- Card (Episode-style) ---------------------------------------------------

function ExtraVideoCard({
  video,
  onOpen,
  onThumbError,
}: {
  video: RawExtraVideo;
  onOpen: () => void;
  onThumbError?: () => void;
}) {
  const title = video.name || "Extra video";

  const ytId =
    video.key ||
    getYouTubeIdFromUrl(video.url || undefined) ||
    null;

  const thumb =
    video.thumbnailUrl ||
    (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);

  const typeLabel = (video.type || video.kind || "").toString();
  const description =
    (video.overview as string | undefined) ||
    (video.description as string | undefined) ||
    "";

  return (
    <Card className="flex h-full flex-col overflow-hidden bg-card/90">
      <button
        type="button"
        onClick={onOpen}
        className="
          group relative aspect-video w-full bg-muted text-left
          overflow-hidden  /* ensures overlay + image clip together */
        "
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            onError={onThumbError}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            No thumbnail
          </div>
        )}

        {/* Hover-only play pill overlay */}
        <div
          className={cn(
            // slightly oversized overlay; clipped by overflow-hidden
            "pointer-events-none absolute -inset-px flex items-center justify-center",
            "bg-black/0 opacity-0 transition-all duration-200",
            "group-hover:bg-black/45 group-hover:opacity-100"
          )}
        >
          <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            <Play className="h-4 w-4" />
            <span>Play</span>
          </span>
        </div>
      </button>

      <CardContent className="flex flex-col gap-1 p-4">
        {typeLabel && (
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            {typeLabel}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
          {title}
        </h3>

        {description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main component ---------------------------------------------------------

export function ExtraVideosSections({
  videos,
  extras,
}: ExtraVideosSectionsProps) {
  // Accept either prop name
  const rawVideos = videos ?? extras ?? [];

  const sections = useMemo(
    () => buildSections(rawVideos),
    [rawVideos]
  );

  // Embla options + wheel gestures (like MediaCarousel)
  const carouselOpts = useMemo(
    () => ({
      align: "start" as const,
      dragFree: true,
    }),
    []
  );

  const plugins = useMemo(
    () => [
      WheelGesturesPlugin({
        forceWheelAxis: "x",
        wheelDraggingClass: "is-wheel-dragging",
      }),
    ],
    []
  );

  const [active, setActive] = useState<{
    id: string;
    title: string;
    ytId: string;
  } | null>(null);

  // Track any thumbnails that error so we can hide their cards
  const [badThumbs, setBadThumbs] = useState<Record<string, true>>({});

  if (!sections.length) return null;

  const handleOpen = (video: RawExtraVideo) => {
    const url = video.url || "";
    const ytId =
      (video.key as string | undefined) ||
      getYouTubeIdFromUrl(url) ||
      "";

    if (!ytId) {
      // Fallback: open raw URL in new tab if we somehow got here
      if (typeof window !== "undefined" && url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }

    setActive({
      id: video.id || video.key || ytId,
      title: video.name || "Video",
      ytId,
    });
  };

  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="space-y-4">
          {/* Heading style to match other sections */}
          <h2 className="mb-3 font-headline text-xl font-semibold">
            {section.label}
          </h2>

          <Carousel
            opts={carouselOpts}
            plugins={plugins}
            className="w-full"
          >
            <CarouselContent className="-ml-4">
              {section.videos.map((video, index) => {
                const stableKey =
                  video.id ||
                  video.key ||
                  video.url ||
                  `extra-${section.id}-${index}`;

                if (badThumbs[stableKey]) return null;

                return (
                  <CarouselItem
                    key={stableKey}
                    className="pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4"
                  >
                    <ExtraVideoCard
                      video={video}
                      onOpen={() => handleOpen(video)}
                      onThumbError={() =>
                        setBadThumbs((prev) => ({
                          ...prev,
                          [stableKey]: true,
                        }))
                      }
                    />
                  </CarouselItem>
                );
              })}
            </CarouselContent>
          </Carousel>
        </section>
      ))}

      {/* YouTube modal */}
      <Dialog
        open={!!active}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent className="w-full max-w-4xl overflow-hidden border-0 bg-black/90 p-0">
          {active && (
            <>
              <DialogHeader className="px-4 pt-4 pb-2">
                <DialogTitle className="text-base text-white sm:text-lg">
                  {active.title}
                </DialogTitle>
              </DialogHeader>
              <div className="relative aspect-video w-full">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${active.ytId}?autoplay=1&rel=0`}
                  title={active.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
