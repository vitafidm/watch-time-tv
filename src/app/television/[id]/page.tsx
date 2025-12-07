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

  // --- Fetch show + episodes -------------------------------------------------

  useEffect(() => {
    if (!user || !showId) {
      if (!user) setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch main show document
        const showRef = doc(db, `users/${user.uid}/shows`, showId);
        const showSnap = await getDoc(showRef);

        if (!showSnap.exists()) {
          setError('Show not found.');
          setShowData(null);
          setEpisodesData([]);
          setLoading(false);
          return;
        }

        const fetchedShowData = showSnap.data();
        setShowData(fetchedShowData);

        // 2. Fetch all associated episodes
        const episodesQuery = query(
          collection(db, `users/${user.uid}/media`),
          where('type', '==', 'episode'),
          where('showRef', '==', showRef.path),
          orderBy('season', 'asc'),
          orderBy('episode', 'asc')
        );

        const episodesSnap = await getDocs(episodesQuery);
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

  // 🔹 NEW: combine extras from show doc + episodes (runs on every render)
  const combinedExtras = useMemo(() => {
    const fromShow = Array.isArray((showData as any)?.extraVideos)
      ? ((showData as any).extraVideos as any[])
      : [];

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
    } catch (err) {
      console.error('Error resolving show play target:', err);
    }
  }, [uid, showId, showData?.title]);

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
    <div className="container space-y-8" data-testid="show-detail">
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

      <div className="pb-[5px]">
         <hr className="border-border" />
      </div>

      {/* Extra videos (Trailers / Clips / Behind the Scenes) */}
     
      {Array.isArray(showData.extraVideos) &&
        showData.extraVideos.length > 0 && (
          <ExtraVideosSections
            videos={showData.extraVideos as any[]}
          />
        )}

      <div className="pb-[5px]">
         <hr className="border-border" />
      </div>

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
