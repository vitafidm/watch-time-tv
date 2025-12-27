"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSearch } from "@/hooks/use-search";
import { useSearchResults } from "@/hooks/use-search-results";

interface Props {
  anchorId: string;
  className?: string;
  onSelect?: (args: { id: string; kind: "movie" | "show" }) => void;
  makeHref?: (args: { id: string; kind: "movie" | "show" }) => string;
}

export default function SearchResultsPopover({
  anchorId,
  className,
  onSelect,
  makeHref,
}: Props) {
  const { searchTerm } = useSearch();
  const { grouped, loading, hasQuery } = useSearchResults(searchTerm, { maxPerType: 8 });
  
  // State to hold exact screen coordinates
  const [coords, setCoords] = useState<{
    top: number;
    left?: number;
    right?: number;
    width: number;
  } | null>(null);

  // We only want to render this on the client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    const updatePosition = () => {
      const anchor = document.getElementById(anchorId);
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const POPOVER_WIDTH = 640; // 40rem approx (matches your max-width)
      const SCREEN_PADDING = 16;

      // Basic coordinates
      const top = rect.bottom + window.scrollY + 8;
      const left = rect.left + window.scrollX;
      
      // COLLISION DETECTION:
      // If aligning left pushes us off-screen, align to the right edge of the input instead.
      const wouldOverflowRight = rect.left + POPOVER_WIDTH > window.innerWidth - SCREEN_PADDING;

      if (wouldOverflowRight) {
        // Align right edge of popover with right edge of input
        setCoords({
          top,
          right: window.innerWidth - (rect.right + window.scrollX),
          width: rect.width, // Pass anchor width to potentially match it
        });
      } else {
        // Default left alignment
        setCoords({
          top,
          left,
          width: rect.width,
        });
      }
    };

    // Update position immediately and on resize/scroll
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true); // true = capture phase for all scrolling elements

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorId, hasQuery, searchTerm]); // Re-calc when query changes size of results

  if (!mounted || !hasQuery || !coords) return null;

  // Render into document.body (Portal) to escape any parent overflow:hidden
  return createPortal(
    <div
      className={cn(
        "absolute z-[9999] w-[min(40rem,92vw)] rounded-2xl border bg-background shadow-xl overflow-hidden",
        className
      )}
      style={{
        top: coords.top,
        left: coords.left,
        right: coords.right,
        // Optional: Ensure it doesn't shrink smaller than the input itself
        minWidth: Math.min(300, coords.width), 
      }}
    >
      {/* Status Bar */}
      <div className="bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary/50" />
            Searching...
          </span>
        ) : (
          "Best Matches"
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto py-2">
        {/* Movies */}
        {grouped.movies.length > 0 && (
          <Section title="Movies">
            {grouped.movies.map((r) => (
              <Row
                key={`m-${r.id}`}
                title={r.normalizedTitle}
                poster={r.posterUrl ?? undefined}
                href={makeHref ? makeHref({ id: r.id, kind: "movie" }) : undefined}
                onClick={() => onSelect?.({ id: r.id, kind: "movie" })}
              />
            ))}
          </Section>
        )}

        {/* Shows */}
        {grouped.shows.length > 0 && (
          <Section title="TV Shows">
            {grouped.shows.map((r) => (
              <Row
                key={`s-${r.id}`}
                title={r.normalizedTitle}
                poster={r.posterUrl ?? undefined}
                href={makeHref ? makeHref({ id: r.id, kind: "show" }) : undefined}
                onClick={() => onSelect?.({ id: r.id, kind: "show" })}
              />
            ))}
          </Section>
        )}

        {/* Empty State */}
        {!loading && grouped.movies.length === 0 && grouped.shows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
            <p>No results found for "{searchTerm}"</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// --- Subcomponents (Optimized) ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 px-2">
      <h3 className="mb-1 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Row({
  title,
  poster,
  href,
  onClick,
}: {
  title: string;
  poster?: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <div
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus:bg-accent active:bg-accent/80"
      role="button"
      tabIndex={0}
    >
      <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted shadow-sm ring-1 ring-border">
        {poster ? (
          <Image
            src={poster}
            alt={title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-110"
            sizes="32px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
            ?
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block outline-none">
        {content}
      </Link>
    );
  }

  return content;
}