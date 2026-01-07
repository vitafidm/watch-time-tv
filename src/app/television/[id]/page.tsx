'use client';

import {
  useState,
  useEffect,
  use,
  useMemo,
  useCallback,
} from 'react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { db } from '@/lib/firebase.client';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  documentId,
} from 'firebase/firestore';
import type { MediaDoc } from '@/functions/src/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ShowHero } from '@/components/ShowHero';
import { EpisodeSelector } from '@/components/EpisodeSelector';
import { CastSection } from '@/components/CastSection';
import { PlayerDialog } from '@/components/PlayerDialog';
import { usePlaybackProgress } from '@/hooks/usePlaybackProgress';
import { resolveShowPlayTargetByRef } from '@/lib/resolveShowPlay';
import { ExtraVideosSections } from '@/components/ExtraVideosSections';

// Episodes with resume/progress decoration
type EpisodeWithResume = MediaDoc & {
  resumeSeconds?: number;
  progressPercent?: number;
};

export default function ShowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const showId = resolvedParams.id;

  const { user } = useAuthUser();
  const uid = user?.uid ?? null;

  const [showData, setShowData] = useState<any>(null);
  const [episodesData, setEpisodesData] = useState<MediaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(
    undefined
  );
  const [selectedStartTime, setSelectedStartTime] = useState<number | null>(
    null
  );

  // --- Fetch show + episodes (Multi-Folder Aware) ----------------------------

  useEffect(() => {
    if (!user || !showId) {
      if (!user) setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch the primary show document requested by URL
        const mainShowRef = doc(db, `users/${user.uid}/shows`, showId);
        const mainShowSnap = await getDoc(mainShowRef);

        if (!mainShowSnap.exists()) {
          setError('Show not found.');
          setShowData(null);
          setEpisodesData([]);
          setLoading(false);
          return;
        }

        const mainData = mainShowSnap.data();
        let finalShowData = { ...mainData, id: mainShowSnap.id };
        let allShowPaths = [mainShowRef.path]; // Always include the requested doc

        // 2. 🔹 CHECK FOR SIBLINGS: Does this show have a TMDB ID?
        // If yes, fetch ALL show docs that share this TMDB ID to merge them.
        if (mainData.tmdbShowId) {
          const siblingsQuery = query(
            collection(db, `users/${user.uid}/shows`),
            where('tmdbShowId', '==', mainData.tmdbShowId)
          );

          const siblingsSnap = await getDocs(siblingsQuery);
          
          if (!siblingsSnap.empty) {
            // We found siblings (including the main one potentially).
            // Let's merge metadata to ensure we have the "best" version of everything.
            // (e.g. if doc A has no poster but doc B does, use doc B's poster)
            
            const allSiblings = siblingsSnap.docs.map(d => ({ ...d.data(), id: d.id, path: d.ref.path }));
            
            // Collect all paths for episode fetching
            allShowPaths = allSiblings.map(s => s.path);

            // Merge Logic: Overwrite nulls in finalShowData with valid data from siblings
            for (const sibling of allSiblings) {
              if (!finalShowData.posterUrl && sibling.posterUrl) finalShowData.posterUrl = sibling.posterUrl;
              if (!finalShowData.backdropUrl && sibling.backdropUrl) finalShowData.backdropUrl = sibling.backdropUrl;
              if (!finalShowData.logoUrl && sibling.logoUrl) finalShowData.logoUrl = sibling.logoUrl;
              
              // Merge Cast (simple concat + dedup later, or just take the longest list)
              if (Array.isArray(sibling.cast) && sibling.cast.length > (finalShowData.cast?.length || 0)) {
                finalShowData.cast = sibling.cast;
              }
              
              // Merge Extra Videos
              if (Array.isArray(sibling.extraVideos)) {
                const existing = (finalShowData.extraVideos || []) as any[];
                finalShowData.extraVideos = [...existing, ...sibling.extraVideos];
              }
            }
          }
        }

        setShowData(finalShowData);

        // 3. 🔹 FETCH EPISODES from ALL matching show folders
        // Firestore 'in' query supports up to 10 values. 
        // If a user has >10 folders for ONE show, we handle the first 10, which handles 99.9% of cases.
        const searchPaths = allShowPaths.slice(0, 10);

        const episodesQuery = query(
          collection(db, `users/${user.uid}/media`),
          where('type', '==', 'episode'),
          where('showRef', 'in', searchPaths), 
          orderBy('season', 'asc'),
          orderBy('episode', 'asc')
        );

        const episodesSnap = await getDocs(episodesQuery);
        
        // 4. Deduplicate Episodes (Optional but recommended)
        // If Folder A and Folder B both have S01E01, we might show duplicates.
        // Let's filter by unique mediaId just in case, or allow them if they are truly different files.
        // For now, we just map them.
        const fetchedEpisodesData = episodesSnap.docs.map(
          (docSnap) =>
            ({
              ...docSnap.data(),
              id: docSnap.id,
            } as MediaDoc)
        );

        setEpisodesData(fetchedEpisodesData);

      } catch (err: any) {
        console.error('Error fetching show details:', err);
        setError(err.message || 'Failed to fetch data.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, showId]);

  // --- Resume & progress wiring for episodes ---------------------------------

  const episodeMediaIds = useMemo(
    () =>
      episodesData
        .map((ep) => (ep as any).mediaId as string | undefined)
        .filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        ),
    [episodesData]
  );

  const progressMap = usePlaybackProgress(uid, episodeMediaIds);

  const episodesWithResume: EpisodeWithResume[] = useMemo(
    () =>
      episodesData.map((ep) => {
        const mid = (ep as any).mediaId as string | undefined;
        const prog = mid ? progressMap[mid] : undefined;
        const pos = prog?.position ?? 0;
        const pct = prog?.percent ?? 0;

        return {
          ...ep,
          resumeSeconds: pos > 0 ? pos : undefined,
          progressPercent: pct,
        };
      }),
    [episodesData, progressMap]
  );

  const hasAnyResume = useMemo(
    () =>
      episodesWithResume.some(
        (ep) =>
          typeof ep.resumeSeconds === 'number' && ep.resumeSeconds > 0
      ),
    [episodesWithResume]
  );

  // 🔹 Combine extras (already partially merged in fetchData, but ensuring uniqueness here)
  const combinedExtras = useMemo(() => {
    const fromShow = Array.isArray((showData as any)?.extraVideos)
      ? ((showData as any).extraVideos as any[])
      : [];

    // Also grab extras from episode docs if any exist
    const fromEpisodes = episodesData.flatMap((ep) => {
      const extras = (ep as any).extraVideos;
      return Array.isArray(extras) ? extras : [];
    });

    const seen = new Set<string>();
    const unique: any[] = [];

    for (const ev of [...fromShow, ...fromEpisodes]) {
      if (!ev) continue;
      const keyValue = (ev.id ?? ev.url ?? ev.key) as string | undefined;
      const key = keyValue && String(keyValue);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(ev);
    }

    return unique;
  }, [showData, episodesData]);

  // --- Handlers --------------------------------------------------------------

  const handleHeroPlay = useCallback(async () => {
    if (!uid || !showId) return;
    try {
      // Logic update: Resolving play target might need to know about siblings too.
      // But usually, resolveShowPlayTargetByRef picks the first unwatched episode.
      // Since we now have 'episodesWithResume' containing ALL episodes from ALL folders,
      // we can just pick from 'episodesWithResume' directly instead of calling the server function if we want.
      // However, sticking to the existing function is safer for now, 
      // though it might only look at the single folder if it's strictly ref-based.
      
      // Better approach for split shows: Find the first episode in our LOADED list that isn't watched.
      const firstUnwatched = episodesWithResume.find(ep => !ep.resumeSeconds && !ep.watched) 
                             || episodesWithResume[0];

      if (firstUnwatched && firstUnwatched.mediaId) {
         setSelectedMediaId(firstUnwatched.mediaId);
         setSelectedStartTime(0);
         setSelectedTitle(firstUnwatched.title || showData?.title);
         setOpen(true);
      } else {
        // Fallback to old behavior if list is empty
        const showRefPath = `users/${uid}/shows/${showId}`;
        const { mediaId, startTime, title } =
          await resolveShowPlayTargetByRef(showRefPath);
  
        setSelectedMediaId(mediaId);
        setSelectedStartTime(
          typeof startTime === 'number' ? Math.max(0, startTime) : 0
        );
        setSelectedTitle(
          title ?? (showData?.title as string | undefined) ?? undefined
        );
        setOpen(true);
      }

    } catch (err) {
      console.error('Error resolving show play target:', err);
    }
  }, [uid, showId, showData?.title, episodesWithResume]);

  const handleEpisodePlay = useCallback((episode: EpisodeWithResume) => {
    const mid = episode.mediaId as string | undefined;
    if (!mid) return;
    setSelectedMediaId(mid);
    setSelectedStartTime(
      typeof episode.resumeSeconds === 'number'
        ? Math.max(0, episode.resumeSeconds)
        : null
    );
    setSelectedTitle(episode.title);
    setOpen(true);
  }, []);

  // --- UI guards -------------------------------------------------------------

  if (loading) {
    return (
      <div className="container mx-auto p-4 space-y-8">
        <Skeleton className="h-[70vh] w-full" />
        <Skeleton className="h-10 w-1/4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-red-400">
        <h1 className="font-headline text-2xl font-bold mb-4">Error</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!showData) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h1 className="font-headline text-2xl font-bold mb-4">
          Show Not Found
        </h1>
        <p>The requested show could not be found in your library.</p>
      </div>
    );
  }

  // --- Main render -----------------------------------------------------------

  return (
    <div className="container px-0 space-y-8" data-testid="show-detail">
      {/* Hero: resume-aware CTA */}
      <ShowHero
        show={showData}
        onPlay={handleHeroPlay}
        hasResume={hasAnyResume}
      />

      {/* Episodes: resume + progress bar in EpisodeSelector */}
      <EpisodeSelector
        episodes={episodesWithResume as any}
        tmdbShowId={showData.tmdbShowId}
        onPlay={handleEpisodePlay}
      />

      {/* 1. First separator always shows (separates Episodes from what comes next) */}
      <div className="pb-[5px]">
         <hr className="border-border" />
      </div>

      {/* 2. Extras AND the second separator only show if content exists */}
      {combinedExtras.length > 0 && (
        <>
          <ExtraVideosSections videos={combinedExtras} />
          
          <div className="pb-[5px]">
             <hr className="border-border" />
          </div>
        </>
      )}

      {Array.isArray(showData.cast) && showData.cast.length > 0 && (
        <CastSection cast={showData.cast} />
      )}

      <PlayerDialog
        open={open}
        onOpenChange={setOpen}
        mediaId={selectedMediaId}
        title={selectedTitle}
        startTime={selectedStartTime}
      />
    </div>
  );
}