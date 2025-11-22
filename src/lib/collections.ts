// src/lib/collections.ts

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  startAfter,
  writeBatch,
  updateDoc,
  serverTimestamp,
  DocumentData,
  QueryDocumentSnapshot,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase.client";

/* =============================================================================
 * Reorders Collection Priority (rows on homepage)
 * ========================================================================== */

/** Returns saved priority order (array of collection IDs) or [] if none. */
export async function getCollectionOrder(uid: string): Promise<string[]> {
  const ref = doc(db, `users/${uid}/meta`, "collectionOrder");
  const snap = await getDoc(ref);
  const data = snap.data();
  const order = Array.isArray(data?.order)
    ? data!.order.filter((x: any) => typeof x === "string")
    : [];
  return order;
}

/** Persists the order of collection IDs (row order on homepage). */
export async function saveCollectionPriority(uid: string, ids: string[]): Promise<void> {
  const ref = doc(db, `users/${uid}/meta`, "collectionOrder");
  await setDoc(ref, { order: ids }, { merge: true });
}

/* =============================================================================
 * Save Collection Order (items within a single collection)
 * ========================================================================== */

/**
 * Re-order the *items* inside a given collection:
 * users/{uid}/collections/{cid}/items/{itemId}
 */
export async function saveCollectionOrder(
  uid: string,
  cid: string,
  orderedItemIds: string[]
) {
  // user/{uid}
  const userDoc = doc(db, "users", uid);

  // user/{uid}/collections/{cid}
  const collDoc = doc(userDoc, "collections", cid);

  // user/{uid}/collections/{cid}/items
  const itemsCol = collection(collDoc, "items");

  const batch = writeBatch(db);
  let orderVal = 0;

  for (const itemId of orderedItemIds) {
    orderVal += 10;
    batch.update(doc(itemsCol, itemId), {
      order: orderVal,
      updatedAt: serverTimestamp(),
    });
  }

  // bump parent updatedAt so rows re-sort/react
  batch.update(collDoc, { updatedAt: serverTimestamp() });
  await batch.commit();
}

/* =============================================================================
 * Types
 * ========================================================================== */

export type UserCollection = {
  title: string;
  description?: string;
  style?: string; // e.g. "poster-grid"
  pinnedToHome?: boolean; // render on home dashboard
  itemCount: number;
  coverImage?: { url: string; aspect?: "2:3" | "16:9" | "1:1" };
  createdAt: any;
  updatedAt: any;
};

export type UserCollectionItem = {
  mediaId: string;
  mediaType: "movie" | "show";
  order: number; // sparse ints: 10, 20, 30…
  addedAt: any;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  year?: number | null;
  genres?: string[];
  videoLink?: string | null;
  overview?: string | null;
  // NOTE: we also write an untyped `uid` field for safer/faster collectionGroup queries
};

/* =============================================================================
 * Fetch Pinned Collections (+ items) for Homepage
 * ========================================================================== */

// Fetch all pinned collections for a user and (optionally) a limited set of items per collection
export async function fetchPinnedCollectionsWithItems(uid: string, itemLimit = 20) {
  const qy = query(
    userCollectionsRef(uid),
    where("pinnedToHome", "==", true),
    orderBy("updatedAt", "desc")
  );
  const snap = await getDocs(qy);

  const results: Array<{
    id: string;
    title: string;
    style?: string;
    pinnedToHome?: boolean;
    items: Array<{
      id: string;
      mediaId: string;
      mediaType: "movie" | "show";
      title: string;
      posterPath?: string | null;
      backdropPath?: string | null;
      year?: number | null;
      genres?: string[];
      videoLink?: string | null;
      overview?: string | null;
    }>;
  }> = [];

  for (const d of snap.docs) {
    const c = { id: d.id, ...(d.data() as any) };

    const itemsQ = query(itemsRef(uid, c.id), orderBy("order", "asc"), limit(itemLimit));
    const itemsSnap = await getDocs(itemsQ);

    const items = await Promise.all(
      itemsSnap.docs.map(async (x) => {
        const data = x.data() as any;

        // Prefer stored fields on the collection item
        let genres: string[] = Array.isArray(data.genres)
          ? data.genres.map((g: any) => String(g))
          : [];
        let videoLink: string | null =
          typeof data.videoLink === "string" && data.videoLink.trim()
            ? data.videoLink.trim()
            : null;
        let overview: string | null =
          typeof data.overview === "string" && data.overview.trim()
            ? data.overview.trim()
            : null;

        // Backward-compat: if any of these are missing, enrich from canonical media doc
        if ((!genres.length || !videoLink || !overview) && data.mediaId && data.mediaType) {
          try {
            const enriched = await enrichBareItemWithMeta(uid, {
              mediaId: String(data.mediaId),
              mediaType: data.mediaType as "movie" | "show",
              title: data.title,
              posterPath: data.posterPath,
              backdropPath: data.backdropPath,
              year: data.year,
            });

            if (!genres.length && enriched.genres?.length) genres = enriched.genres;
            if (!videoLink && enriched.videoLink) videoLink = enriched.videoLink;
            if (!overview && enriched.overview) overview = enriched.overview;
          } catch (err) {
            console.error("[collections] failed to enrich pinned item meta", {
              uid,
              collectionId: c.id,
              mediaId: data.mediaId,
              mediaType: data.mediaType,
              err,
            });
          }
        }

        return {
          id: x.id, // collection item doc id
          mediaId: data.mediaId,
          mediaType: data.mediaType as "movie" | "show",
          title: data.title,
          posterPath: data.posterPath ?? null,
          backdropPath: data.backdropPath ?? null,
          year: typeof data.year === "number" ? data.year : null,
          genres,
          videoLink,
          overview,
        };
      })
    );

    results.push({
      id: c.id,
      title: c.title,
      style: c.style,
      pinnedToHome: c.pinnedToHome,
      items,
    });
  }

  return results;
}

/* =============================================================================
 * Small utils
 * ========================================================================== */

// Drop only undefined (Firestore forbids undefined, allows null/0/false)
const clean = <T extends Record<string, any>>(obj: T): T => {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
};

// user/{uid}
const userRef = (uid: string) => doc(db, "users", uid);

// user/{uid}/collections
const userCollectionsRef = (uid: string) => collection(userRef(uid), "collections");

// user/{uid}/collections/{cid}
const collectionRef = (uid: string, cid: string) => doc(userCollectionsRef(uid), cid);

// user/{uid}/collections/{cid}/items
const itemsRef = (uid: string, cid: string) => collection(collectionRef(uid, cid), "items");

/* =============================================================================
 * Media meta enrichment helpers
 * ========================================================================== */

function extractMetaFromMediaDoc(data: any): {
  genres: string[];
  videoLink: string | null;
  overview: string | null;
} {
  // genres: prefer `genres`, then `genreNames`
  let genres: string[] = [];
  if (Array.isArray(data?.genres)) {
    genres = data.genres.map((g: any) => String(g));
  } else if (Array.isArray(data?.genreNames)) {
    genres = data.genreNames.map((g: any) => String(g));
  }

  // videoLink: already a URL in your docs
  const videoLink =
    typeof data?.videoLink === "string" && data.videoLink.trim().length > 0
      ? data.videoLink.trim()
      : null;

  // overview: prefer overview, then description/plot
  let overview: string | null = null;
  if (typeof data?.overview === "string" && data.overview.trim()) {
    overview = data.overview.trim();
  } else if (typeof data?.description === "string" && data.description.trim()) {
    overview = data.description.trim();
  } else if (typeof data?.plot === "string" && data.plot.trim()) {
    overview = data.plot.trim();
  }

  return { genres, videoLink, overview };
}

async function enrichBareItemWithMeta(
  uid: string,
  it: {
    mediaId: string;
    mediaType: "movie" | "show";
    title: string;
    posterPath?: string | null;
    backdropPath?: string | null;
    year?: number | null;
  }
): Promise<
  Pick<
    UserCollectionItem,
    | "mediaId"
    | "mediaType"
    | "title"
    | "posterPath"
    | "backdropPath"
    | "year"
    | "genres"
    | "videoLink"
    | "overview"
  >
> {
  let genres: string[] = [];
  let videoLink: string | null = null;
  let overview: string | null = null;

  try {
    // Primary path based on mediaType
    const primaryPath =
      it.mediaType === "show"
        ? `users/${uid}/shows/${it.mediaId}`
        : `users/${uid}/media/${it.mediaId}`;

    let snap = await getDoc(doc(db, primaryPath));

    // Fallback: some TV records may only live in /media (episodes)
    if (!snap.exists() && it.mediaType === "show") {
      const fallbackPath = `users/${uid}/media/${it.mediaId}`;
      snap = await getDoc(doc(db, fallbackPath));
    }

    if (snap.exists()) {
      const data = snap.data() as any;
      const extracted = extractMetaFromMediaDoc(data);
      genres = extracted.genres;
      videoLink = extracted.videoLink;
      overview = extracted.overview;
    }
  } catch (err) {
    console.error("[collections] enrichBareItemWithMeta failed", {
      uid,
      mediaId: it.mediaId,
      mediaType: it.mediaType,
      err,
    });
  }

  return {
    mediaId: String(it.mediaId),
    mediaType: it.mediaType,
    title: it.title,
    posterPath: it.posterPath ?? null,
    backdropPath: it.backdropPath ?? null,
    year: typeof it.year === "number" ? it.year : null,
    genres,
    videoLink,
    overview,
  };
}

/* =============================================================================
 * Create
 * ========================================================================== */

export async function createCollectionWithItems(
  uid: string,
  title: string,
  items: Omit<UserCollectionItem, "order" | "addedAt">[],
  opts?: { style?: string; pinnedToHome?: boolean }
) {
  const now = serverTimestamp();

  const colDoc = await addDoc(userCollectionsRef(uid), {
    title,
    style: opts?.style ?? "poster-grid",
    pinnedToHome: !!opts?.pinnedToHome,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  } as UserCollection);

  const batch = writeBatch(db);

  // Enrich from canonical movie/show docs
  const enriched = await Promise.all(
    items.map((it) =>
      enrichBareItemWithMeta(uid, {
        mediaId: String(it.mediaId),
        mediaType: it.mediaType,
        title: it.title,
        posterPath: it.posterPath,
        backdropPath: it.backdropPath,
        year: it.year,
      })
    )
  );

  let orderVal = 0;
  for (const it of enriched) {
    const ref = doc(itemsRef(uid, colDoc.id));
    const payload = clean({
      ...it,
      uid, // stamp uid for collectionGroup queries
      order: (orderVal += 10),
      addedAt: now,
      posterPath: it.posterPath ?? null,
      backdropPath: it.backdropPath ?? null,
      year: it.year ?? null,
      genres: it.genres ?? [],
      videoLink: it.videoLink ?? null,
      overview: it.overview ?? null,
    } as UserCollectionItem);
    batch.set(ref, payload);
  }

  batch.update(colDoc, {
    itemCount: enriched.length,
    updatedAt: now,
    ...(enriched[0]?.posterPath
      ? { coverImage: { url: enriched[0]!.posterPath, aspect: "2:3" as const } }
      : {}),
  });

  await batch.commit();
  return colDoc.id;
}

/* =============================================================================
 * Read collections + items
 * ========================================================================== */

export async function fetchCollections(uid: string) {
  const qy = query(userCollectionsRef(uid), orderBy("updatedAt", "desc"));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserCollection) }));
}

export async function fetchCollectionItems(uid: string, cid: string) {
  const qy = query(itemsRef(uid, cid), orderBy("order", "asc"));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserCollectionItem) }));
}

/* =============================================================================
 * Single collection meta + ordered items (used by Edit modal)
 * ========================================================================== */

export async function getCollection(uid: string, cid: string) {
  const snap = await getDoc(collectionRef(uid, cid));
  if (!snap.exists()) throw new Error("Collection not found");
  return { id: snap.id, ...(snap.data() as UserCollection) };
}

export async function getCollectionItemsOrdered(uid: string, cid: string) {
  const qy = query(itemsRef(uid, cid), orderBy("order", "asc"));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserCollectionItem) }));
}

/* =============================================================================
 * Update meta
 * ========================================================================== */

export async function updateCollectionMeta(
  uid: string,
  cid: string,
  patch: Partial<Pick<UserCollection, "title" | "style" | "pinnedToHome" | "coverImage">>
) {
  await updateDoc(collectionRef(uid, cid), clean({ ...patch, updatedAt: serverTimestamp() }));
}

/* =============================================================================
 * Upsert / diff items for Edit flow
 * ========================================================================== */

type BareItem = {
  mediaId: string;
  mediaType: "movie" | "show";
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  year?: number | null;
};

export async function upsertCollectionItems(
  uid: string,
  cid: string,
  items: BareItem[]
) {
  const now = serverTimestamp();
  const baseRef = collectionRef(uid, cid);

  // Current items
  const current = await getCollectionItemsOrdered(uid, cid);
  const key = (x: { mediaType: string; mediaId: string }) => `${x.mediaType}:${x.mediaId}`;

  // Desired list with sparse order
  let orderVal = 0;
  const desired = items.map((it) => ({
    ...it,
    order: (orderVal += 10),
  }));

  const currentMap = new Map(current.map((c) => [key(c), c]));
  const desiredMap = new Map(desired.map((d) => [key(d), d]));

  const batch = writeBatch(db);

  // Deletes
  for (const [k, cur] of currentMap) {
    if (!desiredMap.has(k)) {
      batch.delete(doc(itemsRef(uid, cid), cur.id));
    }
  }

  // Upserts / updates
  for (const [k, want] of desiredMap) {
    const existing = currentMap.get(k);

    if (existing) {
      // Existing item: keep existing genres/videoLink/overview; update basic fields + order
      batch.update(
        doc(itemsRef(uid, cid), existing.id),
        clean({
          title: want.title,
          posterPath: want.posterPath ?? null,
          backdropPath: want.backdropPath ?? null,
          year: want.year ?? null,
          order: want.order,
          updatedAt: now,
        })
      );
    } else {
      // NEW item → enrich from canonical movie/show doc
      const enriched = await enrichBareItemWithMeta(uid, {
        mediaId: String(want.mediaId),
        mediaType: want.mediaType,
        title: want.title,
        posterPath: want.posterPath,
        backdropPath: want.backdropPath,
        year: want.year,
      });

      const newRef = doc(itemsRef(uid, cid));
      batch.set(
        newRef,
        clean({
          uid, // stamp uid
          ...enriched,
          order: want.order,
          addedAt: now,
          updatedAt: now,
          posterPath: enriched.posterPath ?? null,
          backdropPath: enriched.backdropPath ?? null,
          year: enriched.year ?? null,
          genres: enriched.genres ?? [],
          videoLink: enriched.videoLink ?? null,
          overview: enriched.overview ?? null,
        } as UserCollectionItem)
      );
    }
  }

  // Parent denorms
  batch.update(
    baseRef,
    clean({
      itemCount: desired.length,
      updatedAt: now,
      ...(desired[0]?.posterPath
        ? { coverImage: { url: desired[0]!.posterPath, aspect: "2:3" as const } }
        : {}),
    })
  );

  await batch.commit();
}

/* =============================================================================
 * Rename / delete (simple helpers)
 * ========================================================================== */

export async function renameCollection(uid: string, cid: string, title: string) {
  await updateDoc(collectionRef(uid, cid), {
    title,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCollection(uid: string, cid: string) {
  // Walk items (small batches are fine for MVP)
  const snap = await getDocs(itemsRef(uid, cid));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(collectionRef(uid, cid));
  await batch.commit();
}

/* =============================================================================
 * Artwork propagation (keep collections in sync when media changes)
 * ========================================================================== */

/**
 * Propagate new poster/backdrop/title to all collection items that reference a media doc.
 * Works even if older items don't have `uid` (we guard by path prefix).
 *
 * NOTE: The first time you run this, Firestore may prompt you to create an index on:
 * items (collection group): uid, mediaType, mediaId
 */
async function resolveCanonicalIdForCollections(
  uid: string,
  kind: "movie" | "show",
  candidateId: string
): Promise<string> {
  if (kind === "show") return String(candidateId);

  // Movie: try to read users/{uid}/media/{docId} and pull `mediaId`
  try {
    const snap = await getDoc(doc(db, `users/${uid}/media`, String(candidateId)));
    if (snap.exists()) {
      const data = snap.data() as any;
      const mediaId = data?.mediaId;
      if (typeof mediaId === "string" && mediaId.trim()) return mediaId;
    }
  } catch {
    // ignore; fall through
  }
  // Fallback: assume provided id is already the streamable id
  return String(candidateId);
}

/**
 * Fan-out updated poster/backdrop/title to all of this user's collection items
 * that reference the media via (mediaId, mediaType).
 *
 * Notes:
 * - Uses collectionGroup("items") so we can touch *all* collections in one pass.
 * - We scope results to this `uid` by checking the doc path prefix.
 * - We batch in chunks of 450 to respect Firestore's 500 ops limit.
 * - We also bump the parent collection's `updatedAt` so rows re-sort/react.
 */

/** export async function propagateMediaArtworkToCollections(
  uid: string,
  kind: "movie" | "show",
  mediaId: string | number,
  patch: {
    posterUrl?: string | null | undefined;
    backdropUrl?: string | null | undefined;
    title?: string | undefined;
  }
): Promise<{ updated: number }> {
  // We don't embed uid in the query path because we need to find items across ALL collections
  // for this user. Security rules will still check the full doc path on each update.
  const itemsQ = query(
    collectionGroup(db, "items"),
    where("mediaType", "==", kind),
    where("mediaId", "==", String(mediaId)) // normalize to string if your data is stored as string
  );

  const snap = await getDocs(itemsQ);

  if (snap.empty) {
    console.debug("[propagate] no collection items to update for", { uid, kind, mediaId });
    return { updated: 0 };
  }

  const batch = writeBatch(db);
  let count = 0;

  snap.forEach((docSnap) => {
    // IMPORTANT: use the doc's own ref path; DO NOT append `/posterPath`
    const ref = docSnap.ref;

    // Build a minimal patch; undefined means "don't touch"
    const updatePayload: Record<string, any> = { updatedAt: serverTimestamp() };
    if (patch.posterUrl !== undefined) updatePayload.posterPath = patch.posterUrl ?? null;
    if (patch.backdropUrl !== undefined) updatePayload.backdropPath = patch.backdropUrl ?? null;
    if (patch.title !== undefined) updatePayload.title = patch.title;

    console.debug("[propagate] updating", ref.path, updatePayload);
    batch.update(ref, updatePayload);
    count += 1;
  });

  await batch.commit();
  console.debug(`[propagate] updated ${count} collection item(s) for`, { kind, mediaId });
  return { updated: count };
} */

/* =============================================================================
 * (Optional) library paging helpers for the modal, if you want them here
 *  - Not strictly required; keeping here avoids circular import mistakes.
 * ========================================================================== */

export async function pageUserMovies(
  uid: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  pageSize = 48
) {
  const base = collection(db, "users", uid, "media");
  const qy = cursor
    ? query(
        base,
        where("tmdbType", "==", "movie"),
        orderBy("__name__"),
        startAfter(cursor),
        limit(pageSize)
      )
    : query(base, where("tmdbType", "==", "movie"), orderBy("__name__"), limit(pageSize));

  const snap = await getDocs(qy);
  return {
    docs: snap.docs,
    items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === pageSize,
  };
}

export async function pageUserShows(
  uid: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  pageSize = 48
) {
  const base = collection(db, "users", uid, "shows");
  const qy = cursor
    ? query(
        base,
        where("tmdbType", "==", "tv"),
        orderBy("__name__"),
        startAfter(cursor),
        limit(pageSize)
      )
    : query(base, where("tmdbType", "==", "tv"), orderBy("__name__"), limit(pageSize));

  const snap = await getDocs(qy);
  return {
    docs: snap.docs,
    items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === pageSize,
  };
}
