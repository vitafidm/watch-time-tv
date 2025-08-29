"use client"

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { MediaItem } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"

interface WatchlistContextType {
  watchlist: MediaItem[];
  addToWatchlist: (item: MediaItem) => void;
  removeFromWatchlist: (itemId: number) => void;
  isOnWatchlist: (itemId: number) => boolean;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

const WATCHLIST_STORAGE_KEY = 'private-cinema-watchlist';

export const WatchlistProvider = ({ children }: { children: ReactNode }) => {
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const storedWatchlist = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (storedWatchlist) {
        setWatchlist(JSON.parse(storedWatchlist));
      }
    } catch (error) {
      console.error("Failed to load watchlist from localStorage", error);
    }
  }, []);

  const saveToLocalStorage = (items: MediaItem[]) => {
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Failed to save watchlist to localStorage", error);
    }
  };

  const addToWatchlist = useCallback((item: MediaItem) => {
    setWatchlist((prev) => {
      if (prev.some(i => i.id === item.id)) {
        return prev;
      }
      const newWatchlist = [...prev, item];
      saveToLocalStorage(newWatchlist);
      toast({
        title: "Added to Watchlist",
        description: `"${item.title}" has been added to your watchlist.`,
      })
      return newWatchlist;
    });
  }, [toast]);

  const removeFromWatchlist = useCallback((itemId: number) => {
    setWatchlist((prev) => {
      const itemToRemove = prev.find(i => i.id === itemId);
      const newWatchlist = prev.filter((item) => item.id !== itemId);
      saveToLocalStorage(newWatchlist);
      if (itemToRemove) {
        toast({
          title: "Removed from Watchlist",
          description: `"${itemToRemove.title}" has been removed.`,
          variant: "destructive",
        })
      }
      return newWatchlist;
    });
  }, [toast]);

  const isOnWatchlist = useCallback((itemId: number) => {
    return watchlist.some((item) => item.id === itemId);
  }, [watchlist]);

  return (
    <WatchlistContext.Provider value={{ watchlist, addToWatchlist, removeFromWatchlist, isOnWatchlist }}>
      {children}
    </WatchlistContext.Provider>
  );
};

export const useWatchlist = () => {
  const context = useContext(WatchlistContext);
  if (context === undefined) {
    throw new Error('useWatchlist must be used within a WatchlistProvider');
  }
  return context;
};
