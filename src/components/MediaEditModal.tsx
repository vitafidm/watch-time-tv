
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Video, Images, Image as ImageIcon, CheckCircle } from "lucide-react";
import Image from "next/image";
import { callFunction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export interface MediaEditModalItem {
  id: string; // Firestore doc ID (can be movie ID or tmdbShowId)
  collectionPath: string; // e.g., "users/<uid>/media" or "users/<uid>/shows"
  kind: 'movie' | 'episode' | 'show';
  current: {
    title?: string;
    normalizedTitle?: string;
    displayTitle?: string;
    tmdbId?: number;
    year?: number;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    videoLink?: string | null;
    showTitle?: string; // Legacy for episodes before shows collection
    showRef?: string; // Legacy for episodes before shows collection
  };
}

interface MediaEditModalProps {
  open: boolean;
  onClose: () => void;
  item: MediaEditModalItem | null;
  onApplied?: (id: string, patch: Partial<any>) => void;
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
};

function tmdbIdFromShowRef(ref?: string | null): number | null {
  if (!ref) return null;
  const m = ref.match(/(?:^|\/)shows\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function titleForSearch(item: MediaEditModalItem | null): string | null {
  if (!item) return null;
  return item.current?.normalizedTitle || item.current?.title || item.current?.showTitle || null;
}

export function MediaEditModal({ open, onClose, item, onApplied }: MediaEditModalProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  const [isFixing, setIsFixing] = React.useState(false);
  const [selectedMatch, setSelectedMatch] = React.useState<{ kind: 'movie' | 'tv'; tmdbId: number; title: string; } | null>(null);
  const [mediaData, setMediaData] = React.useState<{ posters:any[], backdrops:any[], videos:any[] } | null>(null);
  const [mediaLoading, setMediaLoading] = React.useState(false);
  const [artworkSaving, setArtworkSaving] = React.useState<{ type: 'poster'|'backdrop'|'video', url: string } | null>(null);

  const displayTitleText = item?.current.displayTitle || item?.current.title || item?.current.showTitle || "Unknown Media";
  const isMovie = item?.kind === 'movie';
  const isShow = item?.kind === 'show';

  const fetchMediaData = React.useCallback(async (kind: 'movie' | 'tv', tmdbId: number) => {
    if (!user) return;
    setMediaLoading(true);
    setMediaData(null);
    try {
      const idToken = await user.getIdToken();
      const data = await callFunction<TmdbMediaData>('tmdbMedia', { kind, tmdbId }, idToken);
      setMediaData(data);
    } catch (error: any) {
      toast({ title: "Failed to fetch media assets", description: error.message, variant: "destructive" });
    } finally {
      setMediaLoading(false);
    }
  }, [user, toast]);

  React.useEffect(() => {
    if (!open || !item) {
      setSearchQuery("");
      setSearchResults([]);
      setSelectedMatch(null);
      setMediaData(null);
      setIsSearching(false);
      return;
    }
    
    const apiKind = isShow ? 'tv' : isMovie ? 'movie' : 'tv';

    async function preload() {
      if (!user) return;

      const initialSearchTitle = titleForSearch(item) || "";
      const initialSearchYear = item.current?.year || null;
      setSearchQuery(initialSearchTitle);
      
      const currentTmdbId = isShow ? Number(item.id) : (item.current?.tmdbId ?? null);

      if (!initialSearchTitle) return;

      setIsSearching(true);
      
      try {
        const idToken = await user.getIdToken();
        const results = await callFunction<SearchResult[]>('tmdbSearch', { q: initialSearchTitle, kind: apiKind, year: initialSearchYear });
        
        let finalResults = results || [];
        let defaultSelection: SearchResult | null = null;
        
        if (currentTmdbId) {
          const currentIndex = finalResults.findIndex(r => r.id === currentTmdbId);
          if (currentIndex > -1) {
            const currentMatch = finalResults.splice(currentIndex, 1)[0];
            finalResults.unshift(currentMatch); // Move current match to the top
            defaultSelection = currentMatch;
          }
        }
        
        if (!defaultSelection && finalResults.length > 0) {
            defaultSelection = finalResults[0];
        }
        
        setSearchResults(finalResults);

        if (defaultSelection) {
          handleSelectMatch(defaultSelection, true);
        }

      } catch (err: any) {
        toast({ title: "Auto-search failed", description: err.message, variant: 'destructive' });
      } finally {
        setIsSearching(false);
      }
    }

    preload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, user, isMovie, isShow]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !item || !user) return;
    setIsSearching(true);
    setSelectedMatch(null);
    setSearchResults([]);
    setMediaData(null);
    try {
      const apiKind = isShow ? 'tv' : isMovie ? 'movie' : 'tv';
      const idToken = await user.getIdToken();
      const results = await callFunction<SearchResult[]>('tmdbSearch', { q: searchQuery, kind: apiKind }, idToken);
      setSearchResults(results || []);
      if(results?.[0]) {
        handleSelectMatch(results[0], true);
      }
    } catch (err: any) {
      toast({ title: "Search failed", description: err.message, variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectMatch = (result: SearchResult, isAutoSelection: boolean = false) => {
    if (!item) return;
    const apiKind = isShow ? 'tv' : isMovie ? 'movie' : 'tv';
    setSelectedMatch({ kind: apiKind, tmdbId: result.id, title: result.title });
    if (!isAutoSelection) {
        setSearchQuery(result.title); // Update search query on manual selection
    }
    fetchMediaData(apiKind, result.id);
  };

  const handleConfirmFix = async () => {
    if (!selectedMatch || !item || !user) return;
    setIsFixing(true);
    try {
      const idToken = await user.getIdToken();
      
      let functionName: string;
      let payload: any;
      let apiKind: 'movie' | 'tv';
  
      if (item.kind === 'show') {
        apiKind = 'tv';
        functionName = 'tmdbFixShow';
        payload = {
          uid: user.uid,
          oldShowId: Number(item.id),
          newShowId: selectedMatch.tmdbId,
        };
      } else {
        apiKind = item.kind === 'movie' ? 'movie' : 'tv';
        functionName = 'tmdbFixMatch';
        payload = {
          collection: item.collectionPath,
          docId: item.id,
          kind: apiKind,
          tmdbId: selectedMatch.tmdbId,
          updateDisplayTitle: true, 
        };
      }
  
      await callFunction(functionName, payload, idToken);
      
      toast({ title: "Match Updated", description: `Successfully re-matched with "${selectedMatch.title}".` });
  
      if (item.kind !== 'show') {
        const patch: Partial<any> = {};
        const newTitle = selectedMatch.title;
        patch.displayTitle = newTitle;
        patch.normalizedTitle = newTitle;
        
        onApplied?.(item.id, patch);
      } else {
        router.refresh();
      }
  
      onClose();
    } catch (err: any) {
      toast({ title: "Fix Match Failed", description: err.message, variant: 'destructive' });
    } finally {
      setIsFixing(false);
    }
  };

  const handleManualSet = async (type: 'poster'|'backdrop'|'video', value: string) => {
    if (!item || !user) return;

    const url = type === 'video' ? `https://www.youtube.com/watch?v=${value}` : value;
    setArtworkSaving({ type, url });

    const payload: { collection: string; docId: string; posterUrl?: string; backdropUrl?: string; videoLink?: string } = {
      collection: item.collectionPath,
      docId: item.id,
    };
    const patch: Partial<any> = {};

    if (type === 'poster') {
      payload.posterUrl = url;
      patch.posterUrl = url;
    } else if (type === 'backdrop') {
      payload.backdropUrl = url;
      patch.backdropUrl = url;
    } else if (type === 'video') {
      payload.videoLink = url;
      patch.videoLink = url;
    }

    try {
      const idToken = await user.getIdToken();
      await callFunction('tmdbManualSet', payload, idToken);
      toast({ title: "Artwork Updated", description: `The ${type} has been set.` });
      onApplied?.(item.id, patch);
    } catch (err: any) {
      toast({
        title: 'Save Failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setArtworkSaving(null);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isFixing && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription>
            Fix incorrect matches or manually set artwork for "{displayTitleText}
            ".
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 pt-4">
          {/* Left Column: Matching */}
          <div className="flex flex-col gap-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isMovie ? 'Search movie title...' : 'Search show title...'
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

            <ScrollArea className="h-[412px] rounded-md border">
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
                        'flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors',
                        selectedMatch?.tmdbId === result.id
                          ? 'bg-primary/10 text-primary-foreground'
                          : 'hover:bg-muted'
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

          {/* Right Column: Artwork Galleries */}
          <div className="flex flex-col gap-4">
            <Tabs defaultValue="posters" className="w-full">
              <TabsList>
                <TabsTrigger value="posters">
                  <ImageIcon className="mr-2" /> Posters
                </TabsTrigger>
                <TabsTrigger value="backdrops">
                  <Images className="mr-2" /> Backdrops
                </TabsTrigger>
                <TabsTrigger value="trailers">
                  <Video className="mr-2" /> Trailers
                </TabsTrigger>
              </TabsList>
              <div className="pt-4 min-h-[360px]">
                {mediaLoading && (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="animate-spin text-muted-foreground" />
                  </div>
                )}
                {!mediaLoading && mediaData && (
                  <>
                    <TabsContent value="posters">
                      <ScrollArea className="h-[360px]">
                        <div className="grid grid-cols-4 gap-2 pr-4">
                          {mediaData.posters.map((p) => (
                            <button
                              key={p.url}
                              onClick={() => handleManualSet('poster', p.url)}
                              className={cn(
                                "relative aspect-[2/3] rounded-md overflow-hidden group",
                                item.current.posterUrl === p.url && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              )}
                            >
                              <Image
                                src={p.url}
                                alt="Poster"
                                fill
                                className="object-cover"
                              />
                              {artworkSaving?.type === 'poster' &&
                                artworkSaving.url === p.url && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <Loader2 className="animate-spin text-white" />
                                  </div>
                                )}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="backdrops">
                      <ScrollArea className="h-[360px]">
                        <div className="grid grid-cols-2 gap-2 pr-4">
                          {mediaData.backdrops.map((b) => (
                            <button
                              key={b.url}
                              onClick={() => handleManualSet('backdrop', b.url)}
                              className={cn(
                                "relative aspect-video rounded-md overflow-hidden group",
                                item.current.backdropUrl === b.url && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              )}
                            >
                              <Image
                                src={b.url}
                                alt="Backdrop"
                                fill
                                className="object-cover"
                              />
                              {artworkSaving?.type === 'backdrop' &&
                                artworkSaving.url === b.url && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <Loader2 className="animate-spin text-white" />
                                  </div>
                                )}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="trailers">
                      <ScrollArea className="h-[360px]">
                        <div className="space-y-2 pr-4">
                          {mediaData.videos.map((v) => {
                            const videoUrl = `https://www.youtube.com/watch?v=${v.key}`;
                            return (
                              <button
                                key={v.key}
                                onClick={() => handleManualSet('video', v.key)}
                                className={cn(
                                  "w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted group",
                                  item.current.videoLink === videoUrl && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                )}
                              >
                                <div className="w-24 aspect-video relative rounded-md overflow-hidden shrink-0">
                                  <Image
                                    src={v.thumbnailUrl}
                                    alt={v.name}
                                    fill
                                    className="object-cover"
                                  />
                                  {artworkSaving?.type === 'video' &&
                                    videoUrl === artworkSaving.url && (
                                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <Loader2 className="animate-spin text-white" />
                                      </div>
                                    )}
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">{v.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {v.type}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </>
                )}
                {!mediaLoading && !mediaData && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
                    <ImageIcon />
                    <p className="mt-2 text-sm">
                      Select a match to see media
                    </p>
                  </div>
                )}
              </div>
            </Tabs>
             <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={onClose} disabled={isFixing}>
                    Cancel
                </Button>
                <Button
                    onClick={handleConfirmFix}
                    disabled={!selectedMatch || isFixing}
                >
                    {isFixing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update Media
                </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

    