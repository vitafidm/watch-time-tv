/**
 * Firestore Seeding Script
 *
 * A Node.js script to populate Firestore with initial data for a specific user.
 * It's designed to work with both the local Firestore emulator and a live production project.
 *
 * ---
 *
 * ### Prerequisites
 * 1.  Ensure you have Node.js and `ts-node` installed (`npm install -g ts-node`).
 * 2.  Set up Firebase Admin SDK credentials. For production, ensure your environment
 *     is authenticated (e.g., `gcloud auth application-default login`). The emulator
 *     does not require authentication.
 *
 * ---
 *
 * ### How to Run
 *
 * **1. Against the Firestore Emulator:**
 *    - Start the emulator: `npm run emu:start`
 *    - In a separate terminal, run the seed script:
 *      ```sh
 *      SEED_UID="test-user-123" SEED_EMAIL="test@example.com" npm run seed
 *      ```
 *    - The `FIRESTORE_EMULATOR_HOST` environment variable is automatically detected by the Admin SDK.
 *
 * **2. Against a Live Firebase Project:**
 *    - Set your active gcloud project: `gcloud config set project YOUR_PROJECT_ID`
 *    - Ensure you are authenticated: `gcloud auth application-default login`
 *    - Run the script with the target UID and email:
 *      ```sh
 *      SEED_UID="some-real-uid" SEED_EMAIL="user@email.com" npm run seed
 *      ```
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'crypto';

// --- Configuration ---
const { SEED_UID, SEED_EMAIL } = process.env;

if (!SEED_UID || !SEED_EMAIL) {
  console.error(
    'Error: Missing required environment variables. Please set SEED_UID and SEED_EMAIL.'
  );
  process.exit(1);
}

// --- Helpers ---
function stableMediaId(serverId: string, path: string): string {
  const identifier = `${serverId}:${path}`;
  return createHash('sha1').update(identifier).digest('hex');
}


// The Admin SDK automatically connects to the emulator if FIRESTORE_EMULATOR_HOST is set.
// No special configuration is needed for that.
initializeApp();
const db = getFirestore();

// --- Main Seeding Function ---
async function seedDatabase() {
  console.log(`Starting seed for user: ${SEED_UID} (${SEED_EMAIL})`);

  try {
    const userRef = db.collection('users').doc(SEED_UID);
    const serversRef = userRef.collection('servers');
    const mediaRef = userRef.collection('media');
    const collectionsRef = userRef.collection('collections');

    const now = Timestamp.now();

    // 1. Create User Document
    await userRef.set({
      uid: SEED_UID,
      email: SEED_EMAIL,
      createdAt: now,
    });
    console.log(` -> Wrote: ${userRef.path}`);

    // 2. Create a Linked Server
    const serverId = 'server-nas-01';
    const serverRef = serversRef.doc(serverId);
    await serverRef.set({
      serverId,
      name: 'My Home NAS',
      status: 'linked',
      apiKeyHash: 'dummy-hash-for-seed',
      salt: 'dummy-salt',
      ip: '192.168.1.100',
      agentVersion: '1.0.0',
      createdAt: now,
      linkedAt: now,
      lastSeen: now,
    });
    console.log(` -> Wrote: ${serverRef.path}`);

    // 3. Create Media Docs
    const mediaPath1 = '/movies/Cosmic.Odyssey.2014.1080p.mkv';
    const mediaId1 = stableMediaId(serverId, mediaPath1);
    
    const mediaPath2 = '/movies/The.Shadow.Realm.2022.1080p.mkv';
    const mediaId2 = stableMediaId(serverId, mediaPath2);

    await mediaRef.doc(mediaId1).set({
      mediaId: mediaId1,
      title: 'Cosmic Odyssey',
      type: 'movie',
      year: 2014,
      filename: 'Cosmic.Odyssey.2014.1080p.mkv',
      path: mediaPath1,
      serverId: serverId,
      size: 1234567890,
      duration: 7200,
      status: 'indexed',
      addedAt: now,
      updatedAt: now,
      playCount: 0,
    });
    console.log(` -> Wrote: ${mediaRef.doc(mediaId1).path}`);

    await mediaRef.doc(mediaId2).set({
        mediaId: mediaId2,
        title: 'The Shadow Realm',
        type: 'movie',
        year: 2022,
        filename: 'The.Shadow.Realm.2022.1080p.mkv',
        path: mediaPath2,
        serverId: serverId,
        size: 2345678901,
        duration: 8100,
        status: 'indexed',
        addedAt: now,
        updatedAt: now,
        playCount: 1,
    });
    console.log(` -> Wrote: ${mediaRef.doc(mediaId2).path}`);


    // 4. Create a Collection
    const collectionId = 'favorite-sci-fi';
    const collectionRef = collectionsRef.doc(collectionId);
    await collectionRef.set({
        collectionId,
        name: 'Favorite Sci-Fi',
        contentIds: [mediaId1, mediaId2],
        hidden: false,
        presentationStyle: 'single_horizontal',
        createdAt: now,
        updatedAt: now,
    });
    console.log(` -> Wrote: ${collectionRef.path}`);


    console.log('\n✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
}

seedDatabase();
