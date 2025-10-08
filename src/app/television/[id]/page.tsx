
import { adminDb } from '@/lib/firebase.server';
import { notFound } from 'next/navigation';
import { MediaDoc } from '@/functions/src/types';

// Helper to convert Firestore Timestamps to serializable format
function serializeFirestoreData(data: any) {
  if (!data) return data;
  for (const key in data) {
    if (data[key] && typeof data[key].toDate === 'function') {
      data[key] = data[key].toDate().toISOString();
    }
  }
  return data;
}

export default async function ShowDetailPage({ params }: { params: { id: string } }) {
  const uid = 'test-user-123'; // Hardcoded for testing
  const showId = params.id;

  // 1. Fetch the main show document
  const showRef = adminDb.doc(`users/${uid}/shows/${showId}`);
  const showSnap = await showRef.get();

  if (!showSnap.exists) {
    notFound();
  }

  const showData = serializeFirestoreData(showSnap.data());

  // 2. Fetch all associated episodes
  const episodesQuery = adminDb.collection(`users/${uid}/media`)
    .where('type', '==', 'episode')
    .where('showRef', '==', showRef.path)
    .orderBy('season', 'asc')
    .orderBy('episode', 'asc');
  
  const episodesSnap = await episodesQuery.get();
  const episodesData = episodesSnap.docs.map(doc => serializeFirestoreData(doc.data() as MediaDoc));

  return (
    <div className="container mx-auto p-4">
      <h1 className="font-headline text-4xl font-bold mb-4">{showData?.title || 'Loading...'}</h1>
      
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Show Data</h2>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs">
            {JSON.stringify(showData, null, 2)}
          </pre>
        </div>
        
        <div>
          <h2 className="text-2xl font-semibold">Episodes Data</h2>
          <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs">
            {JSON.stringify(episodesData, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
