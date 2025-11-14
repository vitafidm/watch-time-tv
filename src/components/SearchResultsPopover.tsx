"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { useSearch } from "@/hooks/use-search";
import { useSearchResults } from "@/hooks/use-search-results";
import Link from "next/link";
import { useRef } from "react";

interface Props {
  anchorId: string;              // id of the <input> to position under
  className?: string;
  onSelect?: (args: { id: string; kind: "movie" | "show" }) => void;
  makeHref?: (args: { id: string; kind: "movie" | "show" }) => string; // optional
}

export default function SearchResultsPopover({ anchorId, className, onSelect, makeHref }: Props) {
  const { searchTerm } = useSearch();
  const { grouped, loading, hasQuery } = useSearchResults(searchTerm, { maxPerType: 8 });

  // crude anchor positioning: place absolutely under the input
  const anchor = typeof document !== "undefined" ? document.getElementById(anchorId) : null;
  const rect = anchor?.getBoundingClientRect();

  if (!hasQuery) return null;

  return (
    <div
      className={cn(
        "absolute z-50 w-[min(40rem,92vw)] rounded-2xl border bg-background shadow-xl",
        className
      )}
      style={{
        top: rect ? rect.bottom + window.scrollY + 8 : undefined,
        left: rect ? rect.left + window.scrollX : undefined,
      }}
    >
      {/* Header / Loading */}
      <div className="px-4 py-2 text-sm text-muted-foreground">
        {loading ? "Searching…" : "Results"}
      </div>

      {/* Movies */}
      {grouped.movies.length > 0 && (
        <Section title="Movies">
          {grouped.movies.map(r => (
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
        <Section title="Shows">
          {grouped.shows.map(r => (
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

      {grouped.movies.length === 0 && grouped.shows.length === 0 && !loading && (
        <div className="px-4 py-3 text-sm text-muted-foreground">No matches.</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2">
      <div className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="flex flex-col">{children}</div>
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
      className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent cursor-pointer"
      onClick={onClick}
    >
      <div className="relative h-14 w-10 overflow-hidden rounded-lg bg-muted shrink-0">
        {poster ? (
          <Image
            src={poster}
            alt=""
            fill
            className="object-cover"
            sizes="40px"
            priority={false}
          />
        ) : null}
      </div>
      <div className="truncate text-sm font-medium">{title}</div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
