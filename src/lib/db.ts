import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  increment,
  getDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase.client';
import type {
  CollectionDoc,
  MediaDoc,
  PlaybackDoc,
  ServerDoc,
  UserDoc,
} from './db.types';
import { createHash } from 'crypto';

//
// User Helpers
//

export async function createUserDoc(uid: string, email: string): Promise<void> {
  const userRef = doc(db, `users/${uid}`);
  await setDoc(
    userRef,
    {
      uid,
      email,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

//
// Server Helpers
//

export async function upsertServer(
  uid: string,
  server: Partial<ServerDoc> & { serverId: string }
): Promise<void> {
  const serverRef = doc(db, `users/${uid}/servers`, server.serverId);
  await setDoc(
    serverRef,
    {
      ...server,
      // @ts-ignore
      createdAt: server.createdAt || serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getServers(uid: string): Promise<ServerDoc[]> {
  const serversRef = collection(db, `users/${uid}/servers`);
  const q = query(serversRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as ServerDoc);
}

//
// Media Helpers
//

/**
 * Creates a stable, deterministic ID for a media item based on its server and path.
 * This prevents duplicate entries if the same file is indexed multiple times.
 * @param serverId The ID of the server where the media is located.
 * @param path The full path of the media file on the server.
 * @returns A SHA-1 hash of the combined serverId and path.
 */
export function stableMediaId(serverId: string, path: string): string {
  const identifier = `${serverId}:${path}`;
  return createHash('sha1').update(identifier).digest('hex');
}

export async function upsertMediaBatch(
  uid: string,
  items: Array<Partial<Omit<MediaDoc, 'mediaId'>> & { path: string, serverId: string }>
): Promise<{ upserted: number }> {
  if (!items || items.length === 0) {
    return { upserted: 0 };
  }

  const mediaRef = collection(db, `users/${uid}/media`);
  const BATCH_SIZE = 500;
  let totalUpserted = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = items.slice(i, i + BATCH_SIZE);

    for (const item of chunk) {
      const mediaId = stableMediaId(item.serverId, item.path);
      const docRef = doc(mediaRef, mediaId);
      
      const docData: Partial<MediaDoc> & { updatedAt: any } = {
        ...item,
        mediaId: mediaId,
        updatedAt: serverTimestamp(),
      };
      
      // Note: `addedAt` is not set here to avoid overwriting it on subsequent updates.
      // It should be set on the initial creation, potentially via a Cloud Function
      // or by checking for the doc's existence first, which is inefficient in a batch.
      // For now, we assume it's set once and then we only update.
      batch.set(docRef, docData, { merge: true });
    }
    await batch.commit();
    totalUpserted += chunk.length;
  }

  return { upserted: totalUpserted };
}

export async function getMediaByType(
  uid: string,
  type: 'movie' | 'episode',
  limitN: number = 20
): Promise<MediaDoc[]> {
  const mediaRef = collection(db, `users/${uid}/media`);
  const q = query(
    mediaRef,
    where('type', '==', type),
    orderBy('addedAt', 'desc'),
    limit(limitN)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as MediaDoc);
}

export async function getRecentlyAdded(
  uid: string,
  limitN: number = 20
): Promise<MediaDoc[]> {
  const mediaRef = collection(db, `users/${uid}/media`);
  const q = query(mediaRef, orderBy('addedAt', 'desc'), limit(limitN));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as MediaDoc);
}


//
// Playback Helpers
//

export async function writePlayback(
  uid: string,
  mediaId: string,
  update: { lastPosition: number; duration: number; incPlayCount?: boolean }
): Promise<void> {
  const playbackRef = doc(db, `users/${uid}/playback`, mediaId);
  const data: Partial<PlaybackDoc> & { lastPlayedAt: any } = {
    mediaId,
    lastPosition: update.lastPosition,
    duration: update.duration,
    lastPlayedAt: serverTimestamp(),
  };

  if (update.incPlayCount) {
    (data as any).playCount = increment(1);
  }

  await setDoc(playbackRef, data, { merge: true });
}

//
// Collection Helpers
//

export async function upsertCollection(
  uid:string,
  c: Partial<CollectionDoc> & { collectionId: string }
): Promise<void> {
    const collectionRef = doc(db, `users/${uid}/collections`, c.collectionId);
    await setDoc(collectionRef, {
        ...c,
        // @ts-ignore
        createdAt: c.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
