
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Video, Images, Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import { callFunction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export interface MediaEditModalItem {
  id: string; // Firestore doc ID (can be movie ID or tmdbShowId)
  collectionPath: string; // e.g., "users/<uid>/media" or "users/<uid>/shows"
  kind: 'movie' | 'episode' | 'show';
  current: {
    title?: string;
    displayTitle?: string;
    tmdbId?: number;
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
  return item.current?.displayTitle || item.current?.title || item.current?.showTitle || null;
}

export function MediaEditModal({ open, onClose, item, onApplied }: MediaEditModalProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  const [updateDisplayTitle, setUpdateDisplayTitle] = React.useState(true);

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
      return;
    }
    
    const apiKind = isMovie || isShow ? 'tv' : 'movie';

    async function preload() {
      if (!user) return;
      setSearchQuery(titleForSearch(item) || "");

      const idToken = await user.getIdToken();
      let tmdbId: number | null = item.current?.tmdbId ?? null;
      
      if (isShow) {
        tmdbId = Number(item.id);
      } else if (item.kind === 'episode') {
        tmdbId = tmdbIdFromShowRef(item.current?.showRef);
      }
      
      let matchTitle: string | null = null;

      if (!tmdbId) {
        const q = titleForSearch(item);
        if (q) {
          try {
            const results = await callFunction<any[]>('tmdbSearch', { q, kind: apiKind }, idToken);
            if (Array.isArray(results) && results.length > 0) {
              tmdbId = results[0].id;
              matchTitle = results[0].title ?? q;
              setSelectedMatch({ kind: apiKind, tmdbId, title: matchTitle });
            }
          } catch {
            // ignore
          }
        }
      } else {
        matchTitle = titleForSearch(item) || '';
        setSelectedMatch({ kind: apiKind, tmdbId, title: matchTitle });
      }

      if (!tmdbId) {
        setMediaData(null);
        return;
      }

      fetchMediaData(apiKind, tmdbId);
    }

    preload();
  }, [open, item, user, isMovie, isShow, fetchMediaData]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !item || !user) return;
    setIsSearching(true);
    setSelectedMatch(null);
    setSearchResults([]);
    try {
      const apiKind = isMovie ? 'movie' : 'tv';
      const idToken = await user.getIdToken();
      const results = await callFunction<SearchResult[]>('tmdbSearch', { q: searchQuery, kind: apiKind }, idToken);
      setSearchResults(results || []);
    } catch (err: any) {
      toast({ title: "Search failed", description: err.message, variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectMatch = (result: SearchResult) => {
    if (!item) return;
    const apiKind = isMovie || isShow ? 'tv' : 'movie';
    setSelectedMatch({ kind: apiKind, tmdbId: result.id, title: result.title });
    fetchMediaData(apiKind, result.id);
  };

  const handleConfirmFix = async () => {
    if (!selectedMatch || !item || !user) return;
    setIsFixing(true);
    try {
      const idToken = await user.getIdToken();
      
      if (item.kind === 'show') {
        await callFunction('tmdbFixShow', {
          uid: user.uid,
          oldShowId: Number(item.id),
          newShowId: selectedMatch.tmdbId,
          keepOverrides: true,
        }, idToken);
        toast({ title: "Show Match Updated", description: `Successfully re-matched with "${selectedMatch.title}". Refreshing list...` });
        router.refresh();
      } else {
         const payload: any = {
          collection: item.collectionPath,
          docId: item.id,
          kind: isMovie ? 'movie' : 'tv', // 'episode' maps to 'tv' on the backend
          tmdbId: selectedMatch.tmdbId,
          updateDisplayTitle,
          includeCast: true,
        };
        await callFunction('tmdbFixMatch', payload, idToken);
        toast({ title: "Match Updated", description: `Successfully matched with "${selectedMatch.title}".` });
        const patch: Partial<any> = {};
        if (updateDisplayTitle) {
          const newTitle = selectedMatch.title;
          patch.displayTitle = newTitle;
          if (item.kind === 'show') {
            patch.title = newTitle;
          }
        }
        onApplied?.(item.id, patch);
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
      toast({ title: "Save Failed", description: err.message, variant: 'destructive' });
    } finally {
      setArtworkSaving(null);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription>
            Fix incorrect matches or manually set artwork for "{displayTitleText}".
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 pt-4">
          {/* Left Column: Matching */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="w-24 flex-shrink-0">
                <Image
                  src={item.current.posterUrl || `https://picsum.photos/seed/${item.id}/100/150`}
                  alt={displayTitleText}
                  width={100}
                  height={150}
                  className="rounded-md object-cover aspect-[2/3] bg-muted"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current Title</p>
                <p className="font-semibold text-lg">{displayTitleText}</p>
              </div>
            </div>

            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isMovie ? "Search movie title..." : "Search show title..."}
                disabled={isSearching || isFixing}
              />
              <Button type="submit" disabled={isSearching || isFixing || !searchQuery}>
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
              </Button>
            </form>

            <ScrollArea className="h-64 rounded-md border">
              <div className="p-2 space-y-1">
                {searchResults.map(result => (
                  <div
                    key={result.id}
                    onClick={() => handleSelectMatch(result)}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors',
                      selectedMatch?.tmdbId === result.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                    )}
                  >
                    {result.posterUrl ? (
                      <Image src={result.posterUrl} alt={result.title} width={40} height={60} className="rounded-sm bg-muted object-cover aspect-[2/3]" />
                    ) : (
                      <div className="w-[40px] h-[60px] rounded-sm bg-muted flex items-center justify-center text-xs text-muted-foreground">No Art</div>
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{result.title}</p>
                      <p className="text-xs text-muted-foreground">{result.year}</p>
                    </div>
                  </div>
                ))}
                {!isSearching && searchResults.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No search results.</p>}
                {isSearching && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" /></div>}
              </div>
            </ScrollArea>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="updateTitle"
                checked={updateDisplayTitle}
                onCheckedChange={(checked) => setUpdateDisplayTitle(!!checked)}
                disabled={!selectedMatch}
              />
              <Label htmlFor="updateTitle" className="text-sm font-normal">
                Update displayed title to "{selectedMatch?.title || '...'}"
              </Label>
            </div>

            <Button onClick={handleConfirmFix} disabled={!selectedMatch || isFixing}>
              {isFixing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Fix
            </Button>
          </div>

          {/* Right Column: Artwork Galleries */}
          <div className="space-y-4">
            <Tabs defaultValue="posters" className="w-full">
              <TabsList>
                <TabsTrigger value="posters"><ImageIcon className="mr-2" /> Posters</TabsTrigger>
                <TabsTrigger value="backdrops"><Images className="mr-2" /> Backdrops</TabsTrigger>
                <TabsTrigger value="trailers"><Video className="mr-2" /> Trailers</TabsTrigger>
              </TabsList>
              <div className="pt-4 min-h-[360px]">
                {mediaLoading && <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-muted-foreground" /></div>}
                {!mediaLoading && mediaData && (
                  <>
                    <TabsContent value="posters">
                      <ScrollArea className="h-[360px]">
                        <div className="grid grid-cols-4 gap-2 pr-4">
                          {mediaData.posters.map(p => (
                            <button key={p.url} onClick={() => handleManualSet('poster', p.url)} className="relative aspect-[2/3] rounded-md overflow-hidden group">
                              <Image src={p.url} alt="Poster" fill className="object-cover" />
                              {artworkSaving?.type === 'poster' && artworkSaving.url === p.url && (
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
                          {mediaData.backdrops.map(b => (
                            <button key={b.url} onClick={() => handleManualSet('backdrop', b.url)} className="relative aspect-video rounded-md overflow-hidden group">
                              <Image src={b.url} alt="Backdrop" fill className="object-cover" />
                              {artworkSaving?.type === 'backdrop' && artworkSaving.url === b.url && (
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
                          {mediaData.videos.map(v => (
                            <button key={v.key} onClick={() => handleManualSet('video', v.key)} className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted group">
                              <div className="w-24 aspect-video relative rounded-md overflow-hidden shrink-0">
                                <Image src={v.thumbnailUrl} alt={v.name} fill className="object-cover" />
                                {artworkSaving?.type === 'video' && `https://www.youtube.com/watch?v=${v.key}` === artworkSaving.url && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <Loader2 className="animate-spin text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="text-left">
                                <p className="text-sm font-medium">{v.name}</p>
                                <p className="text-xs text-muted-foreground">{v.type}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </>
                )}
                {!mediaLoading && !mediaData && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
                    <ImageIcon />
                    <p className="mt-2 text-sm">Select a match to see media</p>
                  </div>
                )}
              </div>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    