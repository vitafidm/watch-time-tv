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
} from './db.types';

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

export async function upsertMediaBatch(
  uid: string,
  items: Array<Partial<MediaDoc> & { mediaId: string; serverId: string }>
): Promise<{ upserted: number }> {
  if (!items.length) {
    return { upserted: 0 };
  }
  const batch = writeBatch(db);
  const mediaRef = collection(db, `users/${uid}/media`);

  for (const item of items) {
    const docRef = doc(mediaRef, item.mediaId);
    batch.set(
      docRef,
      {
        ...item,
        updatedAt: serverTimestamp(),
        // addedAt should only be set on creation, which is hard to check in a batch.
        // A more robust solution might use a Cloud Function to manage this.
        // For the client, we'll rely on the seed script or initial insert to set it.
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { upserted: items.length };
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
        createdAt: c.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
