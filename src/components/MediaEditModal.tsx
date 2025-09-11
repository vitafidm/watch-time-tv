
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2 } from "lucide-react";
import Image from "next/image";
import { callFunction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Checkbox } from "@/components/ui/checkbox";

export interface MediaEditModalItem {
  id: string; // Firestore doc ID
  collectionPath: string; // e.g., "users/<uid>/media"
  kind: 'movie' | 'episode';
  current: {
    title?: string;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    videoLink?: string | null;
    showTitle?: string;
  };
}

interface MediaEditModalProps {
  open: boolean;
  onClose: () => void;
  item: MediaEditModalItem | null;
  onApplied?: (id: string, patch: Partial<any>) => void;
}

// TMDB search result type
type SearchResult = {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

export function MediaEditModal({ open, onClose, item, onApplied }: MediaEditModalProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();

  // State for Matching
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [selectedMatch, setSelectedMatch] = React.useState<{ kind: 'movie' | 'tv'; tmdbId: number; title: string; } | null>(null);
  const [updateDisplayedTitle, setUpdateDisplayedTitle] = React.useState(true);
  const [isFixing, setIsFixing] = React.useState(false);

  // State for Artwork
  const [posterUrl, setPosterUrl] = React.useState("");
  const [backdropUrl, setBackdropUrl] = React.useState("");
  const [trailerUrl, setTrailerUrl] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  
  const displayTitle = item?.current.title || item?.current.showTitle || "Unknown Media";

  React.useEffect(() => {
    if (item) {
      // Pre-fill search with current title
      const titleToSearch = item.kind === 'episode' ? item.current.showTitle : item.current.title;
      setSearchQuery(titleToSearch || "");

      // Pre-fill artwork URLs
      setPosterUrl(item.current.posterUrl || "");
      setBackdropUrl(item.current.backdropUrl || "");
      setTrailerUrl(item.current.videoLink || "");

      // Reset search state
      setSearchResults([]);
      setSelectedMatch(null);
    }
  }, [item]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !item || !user) return;
    setIsSearching(true);
    setSelectedMatch(null);
    setSearchResults([]);

    try {
        const idToken = await user.getIdToken();
        const kind = item.kind === 'episode' ? 'tv' : 'movie';
        const results = await callFunction<SearchResult[]>('tmdbSearch', { q: searchQuery, kind }, idToken);
        setSearchResults(results || []);
    } catch (err: any) {
        toast({ title: "Search failed", description: err.message, variant: 'destructive' });
    } finally {
        setIsSearching(false);
    }
  };

  const handleSelectMatch = (result: SearchResult) => {
    if (!item) return;
    setSelectedMatch({
      kind: item.kind === 'episode' ? 'tv' : 'movie',
      tmdbId: result.id,
      title: result.title,
    });
  };

  const handleConfirmFix = async () => {
    if (!selectedMatch || !item || !user) return;
    setIsFixing(true);

    try {
        const idToken = await user.getIdToken();
        const payload = {
            collection: item.collectionPath,
            docId: item.id,
            kind: selectedMatch.kind,
            tmdbId: selectedMatch.tmdbId,
            includeCast: true, 
        };

        const result = await callFunction('tmdbFixMatch', payload, idToken);
        
        toast({ title: "Match Updated", description: `Successfully matched with "${selectedMatch.title}".` });
        
        const patch: Partial<any> = {};
        if (updateDisplayedTitle) {
          patch.title = selectedMatch.title;
          patch.showTitle = selectedMatch.title;
        }

        onApplied?.(item.id, patch);
        onClose();
    } catch (err: any) {
        toast({ title: "Fix Match Failed", description: err.message, variant: 'destructive' });
    } finally {
        setIsFixing(false);
    }
  };

  const handleSaveArtwork = async () => {
    if (!item || !user) return;
    setIsSaving(true);
    
    try {
      const idToken = await user.getIdToken();
      const payload: { collection: string; docId: string; posterUrl?: string; backdropUrl?: string; videoLink?: string } = {
        collection: item.collectionPath,
        docId: item.id,
      };

      const patch: Partial<any> = {};

      if (posterUrl !== (item.current.posterUrl || '')) {
        payload.posterUrl = posterUrl;
        patch.posterUrl = posterUrl;
      }
      if (backdropUrl !== (item.current.backdropUrl || '')) {
        payload.backdropUrl = backdropUrl;
        patch.backdropUrl = backdropUrl;
      }
      if (trailerUrl !== (item.current.videoLink || '')) {
        payload.videoLink = trailerUrl;
        patch.videoLink = trailerUrl;
      }

      if (Object.keys(patch).length === 0) {
        toast({ title: "No Changes", description: "The artwork URLs are the same." });
        setIsSaving(false);
        return;
      }

      await callFunction('tmdbManualSet', payload, idToken);

      toast({ title: "Artwork Saved", description: "Custom URLs have been saved and locked." });
      onApplied?.(item.id, patch);
      onClose();

    } catch (err: any) {
      toast({ title: "Save Artwork Failed", description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription>
            Fix incorrect matches or manually set artwork for "{displayTitle}".
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 pt-4">
            {/* Left Column: Matching */}
            <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                    <div className="w-24 flex-shrink-0">
                        <Image 
                            src={item.current.posterUrl || '/placeholder.png'} 
                            alt={displayTitle}
                            width={100}
                            height={150}
                            className="rounded-md object-cover aspect-[2/3] bg-muted"
                        />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Current Title</p>
                        <p className="font-semibold text-lg">{displayTitle}</p>
                    </div>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2">
                    <Input 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={item.kind === 'episode' ? "Search show title..." : "Search movie title..."}
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
                                className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${selectedMatch?.tmdbId === result.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
                            >
                                {result.posterUrl ?
                                    <Image src={result.posterUrl} alt={result.title} width={40} height={60} className="rounded-sm bg-muted object-cover aspect-[2/3]" />
                                    : <div className="w-[40px] h-[60px] rounded-sm bg-muted flex items-center justify-center text-xs text-muted-foreground">No Art</div>
                                }
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
                    <Checkbox id="updateTitle" checked={updateDisplayedTitle} onCheckedChange={(checked) => setUpdateDisplayedTitle(!!checked)} disabled={!selectedMatch} />
                    <Label htmlFor="updateTitle" className="text-sm font-normal">Update displayed title to "{selectedMatch?.title || '...'}"</Label>
                </div>

                <Button onClick={handleConfirmFix} disabled={!selectedMatch || isFixing}>
                  {isFixing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Fix
                </Button>
            </div>

            {/* Right Column: Artwork */}
            <div className="space-y-4">
                <h3 className="font-semibold text-lg border-b pb-2">Manual Overrides</h3>
                <div className="space-y-2">
                    <Label htmlFor="posterUrl">Poster URL</Label>
                    <Input id="posterUrl" value={posterUrl} onChange={e => setPosterUrl(e.target.value)} placeholder="https://..." disabled={isSaving} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="backdropUrl">Backdrop URL</Label>
                    <Input id="backdropUrl" value={backdropUrl} onChange={e => setBackdropUrl(e.target.value)} placeholder="https://..." disabled={isSaving} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="trailerUrl">Trailer URL (YouTube)</Label>
                    <Input id="trailerUrl" value={trailerUrl} onChange={e => setTrailerUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." disabled={isSaving} />
                </div>
                <div className="flex justify-end pt-4">
                    <Button onClick={handleSaveArtwork} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Artwork
                    </Button>
                </div>
            </div>
        </div>
        <DialogFooter className="pt-6">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    