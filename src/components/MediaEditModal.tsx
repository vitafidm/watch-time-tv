
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2 } from "lucide-react";
import Image from "next/image";

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
}

// Mock search result type
type SearchResult = {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

export function MediaEditModal({ open, onClose, item }: MediaEditModalProps) {
  const [activeTab, setActiveTab] = React.useState("match");
  
  // State for Match tab
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = React.useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);

  // State for Artwork tab
  const [posterUrl, setPosterUrl] = React.useState("");
  const [backdropUrl, setBackdropUrl] = React.useState("");
  const [trailerUrl, setTrailerUrl] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

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
      setSelectedResult(null);
    }
  }, [item]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !item) return;
    setIsSearching(true);
    setSelectedResult(null);
    console.log(`[MediaEditModal] Searching for ${item.kind}: "${searchQuery}"`);
    
    // MOCK NETWORK CALL
    setTimeout(() => {
        setSearchResults([
            { id: 123, title: `${searchQuery} (Search Result 1)`, year: 2022, posterUrl: 'https://picsum.photos/seed/res1/185/278' },
            { id: 456, title: "Another Movie", year: 2020, posterUrl: 'https://picsum.photos/seed/res2/185/278' },
        ]);
        setIsSearching(false);
    }, 1000);
  };
  
  const handleConfirmFix = () => {
    if (!selectedResult || !item) return;
    console.log(`[MediaEditModal] Confirming fix for item ${item.id} with TMDB ID ${selectedResult.id}`);
    onClose();
  };

  const handleSaveArtwork = () => {
    if (!item) return;
    setIsSaving(true);
    console.log(`[MediaEditModal] Saving custom artwork for item ${item.id}`, { posterUrl, backdropUrl, trailerUrl });
    
    // MOCK NETWORK CALL
    setTimeout(() => {
        setIsSaving(false);
        onClose();
    }, 1000);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
          <DialogDescription>
            Fix incorrect matches or manually set artwork for "{item.current.title}".
          </DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="match">Fix Match</TabsTrigger>
            <TabsTrigger value="artwork">Artwork / Trailer</TabsTrigger>
          </TabsList>
          
          <TabsContent value="match" className="space-y-4 pt-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={item.kind === 'episode' ? "Search show title..." : "Search movie title..."}
                disabled={isSearching}
              />
              <Button type="submit" disabled={isSearching || !searchQuery}>
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
              </Button>
            </form>
            <ScrollArea className="h-64 rounded-md border">
                <div className="p-4 space-y-2">
                    {searchResults.map(result => (
                        <div 
                            key={result.id}
                            onClick={() => setSelectedResult(result)}
                            className={`flex items-center gap-4 p-2 rounded-md cursor-pointer transition-colors ${selectedResult?.id === result.id ? 'bg-accent' : 'hover:bg-muted'}`}
                        >
                            <Image src={result.posterUrl || `https://picsum.photos/seed/${result.id}/50/75`} alt={result.title} width={50} height={75} className="rounded-sm bg-muted object-cover aspect-[2/3]" />
                            <div>
                                <p className="font-semibold">{result.title}</p>
                                <p className="text-sm text-muted-foreground">{result.year}</p>
                            </div>
                        </div>
                    ))}
                    {!isSearching && searchResults.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No search results.</p>}
                    {isSearching && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" /></div>}
                </div>
            </ScrollArea>
             <DialogFooter>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleConfirmFix} disabled={!selectedResult}>Confirm Fix</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="artwork" className="space-y-4 pt-4">
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
             <DialogFooter className="pt-4">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSaveArtwork} disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    Save
                </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
