
'use client';

import { useState, useEffect, use } from 'react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { db } from '@/lib/firebase.client';
import { doc, getDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import type { MediaDoc } from '@/functions/src/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ShowHero } from '@/components/ShowHero';
import { EpisodeSelector } from '@/components/EpisodeSelector';

// Helper to convert Firestore Timestamps to serializable format for <pre> tag
function serializeFirestoreData(data: any) {
  if (!data) return data;
  const serialized = { ...data };
  for (const key in serialized) {
    if (serialized[key] && typeof serialized[key].toDate === 'function') {
      serialized[key] = serialized[key].toDate().toISOString();
    }
  }
  return serialized;
}

export default function ShowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const showId = resolvedParams.id;
  const { user } = useAuthUser();

  const [showData, setShowData] = useState<any>(null);
  const [episodesData, setEpisodesData] = useState<MediaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !showId) {
      if (!user) setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch the main show document
        const showRef = doc(db, `users/${user.uid}/shows`, showId);
        const showSnap = await getDoc(showRef);

        if (!showSnap.exists()) {
          setError('Show not found.');
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
        const fetchedEpisodesData = episodesSnap.docs.map(doc => ({...doc.data(), id: doc.id}) as MediaDoc);
        setEpisodesData(fetchedEpisodesData);

      } catch (err: any) {
        console.error("Error fetching show details:", err);
        setError(err.message || 'Failed to fetch data.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, showId]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 space-y-8">
        <Skeleton className="h-screen w-full -mt-16 -ml-4 sm:-ml-6" />
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
            <h1 className="font-headline text-2xl font-bold mb-4">Show Not Found</h1>
            <p>The requested show could not be found in your library.</p>
        </div>
      )
  }

  return (
    <div>
      {!loading && showData && (
        <>
          <ShowHero show={showData} />
          <div className="container mx-auto p-4 relative z-10 space-y-8 mt-8">
            <EpisodeSelector episodes={episodesData} />
          </div>
        </>
      )}
    </div>
  );
}
