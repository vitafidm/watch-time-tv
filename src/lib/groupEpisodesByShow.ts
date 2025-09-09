
'use client';

import type { Timestamp } from 'firebase/firestore';
import { deriveShowName, showSlug } from './showKey';

export type EpisodeDoc = {
  id: string;
  type: 'episode';
  showId?: string; // This might be assigned by an enrichment process
  showTitle?: string; // This might be assigned by an enrichment process
  title?: string;
  posterUrl?: string;
  addedAt?: Timestamp | string | number; // Firestore timestamp, ISO string, or millis
  season?: number;
  episode?: number;
  [k: string]: any;
};

export type ShowListItem = {
  id: string; // showId or a synthetic ID
  title: string;
  posterUrl?: string;
  episodeCount: number;
  latestAddedAt?: number; // Milliseconds for sorting
};

/**
 * Safely coerces various date formats to milliseconds since epoch.
 */
function toMillis(v: EpisodeDoc['addedAt']): number {
  if (!v) return 0;
  // Firestore Timestamp
  if (typeof (v as Timestamp).toMillis === 'function') {
    return (v as Timestamp).toMillis();
  }
  // ISO String or other parsable date string
  if (typeof v === 'string') {
    const d = Date.parse(v);
    return isNaN(d) ? 0 : d;
  }
  // Milliseconds number
  if (typeof v === 'number') {
    return v;
  }
  return 0;
}

export function groupEpisodesByShow(episodes: EpisodeDoc[]): ShowListItem[] {
  const showsMap = new Map<string, {
    name: string;
    episodes: EpisodeDoc[];
    posterUrl?: string;
    latestAddedAt: number;
  }>();

  for (const episode of episodes) {
    const name = deriveShowName(episode as any);
    const id = showSlug(name);
    
    if (!showsMap.has(id)) {
      showsMap.set(id, { name, episodes: [], latestAddedAt: 0 });
    }

    const group = showsMap.get(id)!;
    group.episodes.push(episode);
    
    const addedAtMs = toMillis(episode.addedAt);
    if (addedAtMs > group.latestAddedAt) {
      group.latestAddedAt = addedAtMs;
    }
  }

  const result: ShowListItem[] = [];
  for (const [id, group] of showsMap.entries()) {
    // Find the best poster: prefer season 1, episode 1, otherwise first available.
    let bestPoster = group.episodes.find(e => e.posterUrl && e.season === 1)?.posterUrl;
    if (!bestPoster) {
        bestPoster = group.episodes.find(e => e.posterUrl)?.posterUrl;
    }

    result.push({
      id,
      title: group.name,
      posterUrl: bestPoster,
      episodeCount: group.episodes.length,
      latestAddedAt: group.latestAddedAt,
    });
  }

  // Sort shows by the most recently added episode in each group, descending.
  result.sort((a, b) => (b.latestAddedAt || 0) - (a.latestAddedAt || 0));

  return result;
}
