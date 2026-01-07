"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Loader2,
  Video,
  Images,
  Image as ImageIcon,
  CheckCircle,
  BadgeCent,
} from "lucide-react";
import Image from "next/image";
import { callFunction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* =============================================================================
 * Helpers
 * ========================================================================== */

function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

/* =============================================================================
 * Types
 * ========================================================================== */

export interface MediaEditModalItem {
  id: string; // media doc id (NOT collection item id)
  collectionPath: string;
  kind: "movie" | "episode" | "show";
  current: {
    title?: string;
    normalizedTitle?: string;
    displayTitle?: string;
    tmdbId?: number;
    // deprecated alias
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    tmdbMovieId?: number;
    year?: number;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    logoUrl?: string | null;
    videoLink?: string | null;
    showTitle?: string;
    showRef?: string;
    filename?: string | null;
  };
}

interface MediaEditModalProps {
  open: boolean;
  onClose: () => void;
  item: MediaEditModalItem | null;
  onApplied?: (id: string, patch: Partial<any>) => void;
  /** Called after a successful update+propagation so parents can refresh UI */
  onAfterUpdate?: () => void;
}

type SearchResult = {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

type TmdbMediaData = {
  posters: { url: string }[];
  backdrops: { url: string }[];
  videos: { key: string; name: string; type: string; thumbnailUrl: string }[];
  logos: { url: string }[];
};

function titleForSearch(item: MediaEditModalItem | null): string | null {
  if (!item) return null;
  return (
    item.current?.normalizedTitle ||
    item.current?.title ||
    item.current?.showTitle ||
    null
  );
}

function resolveInitialTmdbId(item: MediaEditModalItem | null) {
  if (!item) return null;
  const cur: any = item.current ?? {};

  if (item.kind === "show") {
    if (typeof cur.tmdbId === "number" && Number.isFinite(cur.tmdbId)) {
      return cur.tmdbId;
    }
    const n = Number(item.id);
    return Number.isFinite(n) ? n : null;
  }

  return cur.tmdbId ?? cur.tmdbMovieId ?? null;
}

/* =============================================================================
 * Sub-Component: Manual URL Input
 * ========================================================================== */

function ManualUrlInput({
  onApply,
  placeholder = "Enter a URL...",
}: {
  onApply: (val: string) => void;
  placeholder?: string;
}) {
  const [val, setVal] = React.useState("");

  const handleApply = () => {
    if (!val.trim()) return;
    onApply(val.trim());
    setVal(""); // Clear after applying
  };

  return (
    // 1. Removed padding (p-3 -> p-0) to flush with edges
    <div className="p-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          // 2. Styled input to be borderless and flush
          className="flex-1 border-0 rounded-none shadow-none focus-visible:ring-0 px-4 h-12"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApply();
            }
          }}
        />
        {/* 3. Removed the Button (Magnifying glass) */}
      </div>
    </div>
  );
}

/* =============================================================================
 * Main Component
 * ========================================================================== */

export function MediaEditModal({
  open,
  onClose,
  item,
  onApplied,
  onAfterUpdate,
}: MediaEditModalProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  // Selected match (staged)
  const [selectedMatch, setSelectedMatch] = React.useState<{
    kind: "movie" | "tv";
    tmdbId: number;
    title: string;
  } | null>(null);

  // Assets for the selected match
  const [mediaData, setMediaData] = React.useState<TmdbMediaData | null>(null);
  const [mediaLoading, setMediaLoading] = React.useState(false);

  // Staged asset picks (not written until Update)
  const [stagedPoster, setStagedPoster] = React.useState<string | null>(null);
  const [stagedBackdrop, setStagedBackdrop] = React.useState<string | null>(
    null
  );
  const [stagedLogo, setStagedLogo] = React.useState<string | null>(null);
  
  // Video staging: either a Key (YouTube) or a raw URL
  const [stagedVideoKey, setStagedVideoKey] = React.useState<string | null>(null);
  const [stagedVideoUrl, setStagedVideoUrl] = React.useState<string | null>(null);

  // Saving state
  const [isFixing, setIsFixing] = React.useState(false);

  const displayTitleText =
    item?.current.filename ||
    item?.current.displayTitle ||
    item?.current.title ||
    item?.current.showTitle ||
    "Unknown Media";
  const isMovie = item?.kind === "movie";
  const isShow = item?.kind === "show";

  const fetchMediaData = React.useCallback(
    async (kind: "movie" | "tv", tmdbId: number) => {
      if (!user) return;
      setMediaLoading(true);
      setMediaData(null);
      try {
        const idToken = await user.getIdToken();
        const data = await callFunction<TmdbMediaData>(
          "tmdbMedia",
          { kind, tmdbId },
          idToken
        );
        setMediaData(data);
      } catch (error: any) {
        toast({
          title: "Failed to fetch media assets",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setMediaLoading(false);
      }
    },
    [user, toast]
  );

  // Auto-select current match or first search result, and load assets
  React.useEffect(() => {
    if (!open || !item) {
      setSearchQuery("");
      setSearchResults([]);
      setSelectedMatch(null);
      setMediaData(null);
      setIsSearching(false);
      
      setStagedPoster(null);
      setStagedBackdrop(null);
      setStagedLogo(null);
      setStagedVideoKey(null);
      setStagedVideoUrl(null);
      return;
    }

    const apiKind: "tv" | "movie" = isShow ? "tv" : "movie";
    const q = (titleForSearch(item) || "").trim();
    const year = item.current?.year ?? null;
    setSearchQuery(q);

    const initialTmdbId = resolveInitialTmdbId(item);

    (async () => {
      if (initialTmdbId) {
        const fallbackTitle =
          item.current.displayTitle ||
          item.current.normalizedTitle ||
          item.current.title ||
          item.current.showTitle ||
          q ||
          "";
        setSelectedMatch({
          kind: apiKind,
          tmdbId: initialTmdbId,
          title: fallbackTitle,
        });
        await fetchMediaData(apiKind, initialTmdbId);

        // background search to populate the left list
        if (q) {
          try {
            setIsSearching(true);
            const idToken = await user!.getIdToken();
            const results = await callFunction<SearchResult[]>(
              "tmdbSearch",
              { q, kind: apiKind, year },
              idToken
            );
            setSearchResults(results || []);
          } catch {
            setSearchResults([]);
          } finally {
            setIsSearching(false);
          }
        }
        return;
      }

      if (q) {
        try {
          setIsSearching(true);
          const idToken = await user!.getIdToken();
          const results = await callFunction<SearchResult[]>(
            "tmdbSearch",
            { q, kind: apiKind, year },
            idToken
          );
          setSearchResults(results || []);
          const first = results?.[0];
          if (first) {
            setSelectedMatch({
              kind: apiKind,
              tmdbId: first.id,
              title: first.title,
            });
            await fetchMediaData(apiKind, first.id);
          }
        } catch (err: any) {
          setSearchResults([]);
          toast({
            title: "Auto-search failed",
            description: err.message,
            variant: "destructive",
          });
        } finally {
          setIsSearching(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, isShow, isMovie]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !item || !user) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const apiKind = isShow ? "tv" : "movie";
      const idToken = await user.getIdToken();
      const results = await callFunction<SearchResult[]>(
        "tmdbSearch",
        { q: searchQuery, kind: apiKind },
        idToken
      );
      setSearchResults(results || []);
      if (results?.[0]) {
        handleSelectMatch(results[0], true);
      }
    } catch (err: any) {
      toast({
        title: "Search failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectMatch = (result: SearchResult, isAuto = false) => {
    if (!item) return;
    const apiKind = isShow ? "tv" : "movie";
    setSelectedMatch({ kind: apiKind, tmdbId: result.id, title: result.title });
    if (!isAuto) setSearchQuery(result.title);
    
    // Reset staged selections when match changes
    setStagedPoster(null);
    setStagedBackdrop(null);
    setStagedLogo(null);
    setStagedVideoKey(null);
    setStagedVideoUrl(null);
    
    fetchMediaData(apiKind, result.id);
  };

  // --- Staging selectors (NO network calls here) ---
  const stagePoster = (url: string) => setStagedPoster(url);
  const stageBackdrop = (url: string) => setStagedBackdrop(url);
  const stageLogo = (url: string) => setStagedLogo(url);
  
  // Handles YouTube Key OR Raw URL
  const stageVideoInput = (input: string) => {
    const ytId = getYouTubeId(input);
    if (ytId) {
      setStagedVideoKey(ytId);
      setStagedVideoUrl(null); // Clear raw url if it resolved to a key
    } else {
      setStagedVideoUrl(input);
      setStagedVideoKey(null); // Clear key if raw url provided
    }
  };

  // Dirty detection for enabling the Update button
  const currentTmdbId = resolveInitialTmdbId(item);
  const matchChanged = !!(
    selectedMatch && selectedMatch.tmdbId !== currentTmdbId
  );
  const posterChanged = !!(
    stagedPoster && stagedPoster !== (item?.current.posterUrl ?? null)
  );
  const backdropChanged = !!(
    stagedBackdrop && stagedBackdrop !== (item?.current.backdropUrl ?? null)
  );
  const logoChanged = !!(
    stagedLogo && stagedLogo !== (item?.current.logoUrl ?? null)
  );

  // Video logic: check key-based construction OR raw url equality
  const currentVideoLink = item?.current.videoLink ?? null;
  const videoChanged = !!(
    (stagedVideoKey && `https://www.youtube.com/watch?v=${stagedVideoKey}` !== currentVideoLink) ||
    (stagedVideoUrl && stagedVideoUrl !== currentVideoLink)
  );

  const hasChanges =
    matchChanged ||
    posterChanged ||
    backdropChanged ||
    logoChanged ||
    videoChanged;

  // Apply everything atomically when user clicks Update
  const handleConfirmFix = async () => {
    if (!item || !user || !selectedMatch) return;
    setIsFixing(true);
    try {
      const idToken = await user.getIdToken();

      // 1) If match changed, fix it first
      if (matchChanged) {
        await callFunction(
          "tmdbFixMatch",
          {
            collection: item.collectionPath,
            docId: item.id,
            kind: selectedMatch.kind,
            tmdbId: selectedMatch.tmdbId,
            updateDisplayTitle: true,
          },
          idToken
        );

        // If user didn’t explicitly pick new artwork/video/logo, default to first assets
        if (mediaData) {
          if (!stagedPoster && mediaData.posters?.[0]?.url) {
            setStagedPoster(mediaData.posters[0].url);
          }
          if (!stagedBackdrop && mediaData.backdrops?.[0]?.url) {
            setStagedBackdrop(mediaData.backdrops[0].url);
          }
          if (!stagedLogo && mediaData.logos?.[0]?.url) {
            setStagedLogo(mediaData.logos[0].url);
          }
          // Default video logic: only if no manual entry
          if (!stagedVideoKey && !stagedVideoUrl && mediaData.videos?.[0]?.key) {
            setStagedVideoKey(mediaData.videos[0].key);
          }
        }
      }

      // 2) Persist any staged assets
      const payload: {
        collection: string;
        docId: string;
        posterUrl?: string;
        backdropUrl?: string;
        videoLink?: string;
        logoUrl?: string;
      } = { collection: item.collectionPath, docId: item.id };

      // 1) Start with anything the user explicitly staged
      if (stagedPoster) payload.posterUrl = stagedPoster;
      if (stagedBackdrop) payload.backdropUrl = stagedBackdrop;
      if (stagedLogo) payload.logoUrl = stagedLogo;

      // Video: prefer Key if set, else Raw URL
      if (stagedVideoKey) {
        payload.videoLink = `https://www.youtube.com/watch?v=${stagedVideoKey}`;
      } else if (stagedVideoUrl) {
        payload.videoLink = stagedVideoUrl;
      }

      // 2) If Match didn't change, keep existing assets if not replaced
      if (!matchChanged) {
        if (!payload.posterUrl && item.current.posterUrl) {
          payload.posterUrl = item.current.posterUrl;
        }
        if (!payload.backdropUrl && item.current.backdropUrl) {
          payload.backdropUrl = item.current.backdropUrl;
        }
      }

      // 3) If Match DID change, use defaults if not staged
      if (matchChanged && mediaData) {
        if (!payload.posterUrl && mediaData.posters?.[0]?.url) {
          payload.posterUrl = mediaData.posters[0].url;
        }
        if (!payload.backdropUrl && mediaData.backdrops?.[0]?.url) {
          payload.backdropUrl = mediaData.backdrops[0].url;
        }
        if (!payload.logoUrl && mediaData.logos?.[0]?.url) {
          payload.logoUrl = mediaData.logos[0].url;
        }
      }

      if (
        payload.posterUrl ||
        payload.backdropUrl ||
        payload.videoLink ||
        payload.logoUrl
      ) {
        await callFunction("tmdbManualSet", payload, idToken);
      }

      // 3) Reflect changes back to caller immediately
      const patch: Record<string, any> = {};

      const newTitle =
        selectedMatch.title ||
        item.current.displayTitle ||
        item.current.normalizedTitle ||
        item.current.title ||
        item.current.showTitle ||
        null;

      if (newTitle) {
        patch.title = newTitle;
        patch.normalizedTitle = newTitle;
        (patch as any).displayTitle = newTitle;
      }

      patch.tmdbId = selectedMatch.tmdbId;

      if (payload.posterUrl) patch.posterUrl = payload.posterUrl;
      if (payload.backdropUrl) patch.backdropUrl = payload.backdropUrl;
      if (payload.videoLink) patch.videoLink = payload.videoLink;
      if (payload.logoUrl) patch.logoUrl = payload.logoUrl;

      onApplied?.(item.id, patch);
      onAfterUpdate?.();

      toast({ title: "Media updated" });
      onClose();
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsFixing(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={() => !isFixing && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription>
            Fix the match or <b>stage</b> new artwork/logo/trailer for &quot;
            {displayTitleText}
            &quot;. Changes are applied when you click <b>Update Media</b>.
          </DialogDescription>
        </DialogHeader>

        {/* MAIN GRID */}
        <div className="grid md:grid-cols-12 gap-6 flex-1 min-h-0">
          {/* LEFT (search + results) */}
          <div className="flex flex-col gap-4 min-h-0 md:col-span-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isMovie ? "Search movie title..." : "Search show title..."
                }
                disabled={isSearching || isFixing}
              />
              <Button
                type="submit"
                disabled={isSearching || isFixing || !searchQuery}
              >
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
              </Button>
            </form>

            <ScrollArea className="flex-1 min-h-0 rounded-md border">
              <div className="p-2 space-y-1">
                {isSearching && searchResults.length === 0 ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-muted-foreground" />
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <div
                      key={result.id}
                      onClick={() => handleSelectMatch(result)}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors",
                        selectedMatch?.tmdbId === result.id
                          ? "bg-primary/10 text-primary-foreground"
                          : "hover:bg-muted"
                      )}
                    >
                      {result.posterUrl ? (
                        <Image
                          src={result.posterUrl}
                          alt={result.title}
                          width={40}
                          height={60}
                          className="rounded-sm bg-muted object-cover aspect-[2/3]"
                        />
                      ) : (
                        <div className="w-[40px] h-[60px] rounded-sm bg-muted flex items-center justify-center text-xs text-muted-foreground">
                          No Art
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{result.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {result.year}
                        </p>
                      </div>
                      {selectedMatch?.tmdbId === result.id && (
                        <CheckCircle className="w-5 h-5 text-primary" />
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    No search results.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* RIGHT (asset tabs) */}
          <div className="flex flex-col gap-4 min-h-0 md:col-span-8">
            <Tabs
              defaultValue="posters"
              className="w-full flex-1 flex flex-col min-h-0"
            >
              <TabsList className="flex w-full shrink-0">
                <TabsTrigger value="posters" className="flex-1">
                  <ImageIcon className="mr-2" /> Posters
                </TabsTrigger>
                <TabsTrigger value="logos" className="flex-1">
                  <BadgeCent className="mr-2" /> Logos
                </TabsTrigger>
                <TabsTrigger value="backdrops" className="flex-1">
                  <Images className="mr-2" /> Backdrops
                </TabsTrigger>
                <TabsTrigger value="trailers" className="flex-1">
                  <Video className="mr-2" /> Trailers
                </TabsTrigger>
              </TabsList>

              {/* TABS CONTENT CONTAINER */}
              <div className="pt-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                {mediaLoading && (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="animate-spin text-muted-foreground" />
                  </div>
                )}

                {!mediaLoading && mediaData && (
                  <>
                    {/* Posters */}
                    <TabsContent
                      value="posters"
                      className="flex-1 flex flex-col min-h-0 m-0 data-[state=inactive]:hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="grid grid-cols-4 gap-2 pr-4 pb-2">
                          {mediaData.posters.map((p) => {
                            const isActive = stagedPoster
                              ? stagedPoster === p.url
                              : item?.current.posterUrl === p.url;
                            return (
                              <button
                                key={p.url}
                                onClick={() => stagePoster(p.url)}
                                className={cn(
                                  "relative aspect-[2/3] rounded-md overflow-hidden group ring-offset-2 ring-offset-background",
                                  isActive ? "ring-2 ring-primary" : "ring-0"
                                )}
                              >
                                <Image
                                  src={p.url}
                                  alt="Poster"
                                  fill
                                  className="object-cover"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                      <ManualUrlInput
                        placeholder="Select poster OR enter image URL..."
                        onApply={stagePoster}
                      />
                    </TabsContent>

                    {/* Logos */}
                    <TabsContent
                      value="logos"
                      className="flex-1 flex flex-col min-h-0 m-0 data-[state=inactive]:hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 pr-4 pb-2">
                          {mediaData.logos.map((l) => {
                            const isActive = stagedLogo
                              ? stagedLogo === l.url
                              : item?.current.logoUrl === l.url;
                            return (
                              <button
                                key={l.url}
                                onClick={() => stageLogo(l.url)}
                                className={cn(
                                  "relative aspect-[4/1] rounded-md overflow-hidden flex items-center justify-center bg-black/60 ring-offset-2 ring-offset-background",
                                  isActive ? "ring-2 ring-primary" : "ring-0"
                                )}
                              >
                                <Image
                                  src={l.url}
                                  alt="Logo"
                                  fill
                                  className="object-contain"
                                />
                              </button>
                            );
                          })}
                          {mediaData.logos.length === 0 && (
                            <p className="col-span-full text-sm text-muted-foreground text-center py-4">
                              No logos available for this title.
                            </p>
                          )}
                        </div>
                      </ScrollArea>
                      <ManualUrlInput
                        placeholder="Select logo OR enter image URL..."
                        onApply={stageLogo}
                      />
                    </TabsContent>

                    {/* Backdrops */}
                    <TabsContent
                      value="backdrops"
                      className="flex-1 flex flex-col min-h-0 m-0 data-[state=inactive]:hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="grid grid-cols-2 gap-2 pr-4 pb-2">
                          {mediaData.backdrops.map((b) => {
                            const isActive = stagedBackdrop
                              ? stagedBackdrop === b.url
                              : item?.current.backdropUrl === b.url;
                            return (
                              <button
                                key={b.url}
                                onClick={() => stageBackdrop(b.url)}
                                className={cn(
                                  "relative aspect-video rounded-md overflow-hidden group ring-offset-2 ring-offset-background",
                                  isActive ? "ring-2 ring-primary" : "ring-0"
                                )}
                              >
                                <Image
                                  src={b.url}
                                  alt="Backdrop"
                                  fill
                                  className="object-cover"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                      <ManualUrlInput
                        placeholder="Select backdrop OR enter image URL..."
                        onApply={stageBackdrop}
                      />
                    </TabsContent>

                    {/* Trailers */}
                    <TabsContent
                      value="trailers"
                      className="flex-1 flex flex-col min-h-0 m-0 data-[state=inactive]:hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="space-y-2 pr-4 pb-2">
                          {mediaData.videos.map((v) => {
                            // Check if this card matches EITHER the staged key OR the current link
                            const isActive = stagedVideoKey
                              ? stagedVideoKey === v.key
                              : item?.current.videoLink ===
                                `https://www.youtube.com/watch?v=${v.key}`;
                            
                            return (
                              <button
                                key={v.key}
                                onClick={() => {
                                  setStagedVideoKey(v.key);
                                  setStagedVideoUrl(null);
                                }}
                                className={cn(
                                  "w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted group ring-offset-2 ring-offset-background",
                                  isActive ? "ring-2 ring-primary" : "ring-0"
                                )}
                              >
                                <div className="w-24 aspect-video relative rounded-md overflow-hidden shrink-0">
                                  <Image
                                    src={v.thumbnailUrl}
                                    alt={v.name}
                                    fill
                                    className="object-cover"
                                  />
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">
                                    {v.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {v.type}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                      <ManualUrlInput
                        placeholder="Select trailer OR enter YouTube/video URL..."
                        onApply={stageVideoInput}
                      />
                    </TabsContent>
                  </>
                )}

                {!mediaLoading && !mediaData && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
                    <ImageIcon className="h-10 w-10 mb-2 opacity-20" />
                    <p className="text-sm">Select a match to see media</p>
                  </div>
                )}
              </div>
            </Tabs>
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex justify-between items-center gap-2 pt-4">
          <div className="text-xs text-muted-foreground">
            Selections are staged. Click <b>Update Media</b> to save.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isFixing}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFix}
              disabled={!hasChanges || isFixing}
            >
              {isFixing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Media
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MediaEditModal;