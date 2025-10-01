import * as functions from "firebase-functions";
import cors from "cors";
import * as admin from "firebase-admin";
import { db } from "./initFirebase";
import { getShowFromCache, CachedShow } from "./showCache";

const corsHandler = cors({ origin: true });

type ShowDoc = {
  tmdbShowId: number; // same as numeric ID parsed from showRef
  title: string;
  displayTitle?: string | null;
  overview?: string;
  genres?: string[];
  posterUrl?: string | null;
  backdropUrl?: string | null;
  posterLocked?: boolean;
  backdropLocked?: boolean;
  videoLink?: string | null;
  episodeCount: number;
  lastAddedAt?: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

function toTimestamp(v: any): FirebaseFirestore.Timestamp | undefined {
  if (!v) return undefined;
  if (v.toDate && v.toMillis) return v as FirebaseFirestore.Timestamp;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : admin.firestore.Timestamp.fromDate(d);
}

// pull numeric id from showRef: "shows/4586" OR "/users/<uid>/shows/4586"
function idFromShowRef(showRef?: unknown): number | null {
  if (typeof showRef !== "string") return null;
  // match "shows/12345" OR "/.../shows/12345"
  const m = showRef.match(/(?:^|\/)shows\/(\d+)/);
  return m ? Number(m[1]) : null;
}


// count episodes for a given show id using showRef equality
async function countEpisodesForShow(
  mediaCol: FirebaseFirestore.CollectionReference,
  uid: string,
  showId: number
) {
  const refA = `shows/${showId}`;
  const refB = `/users/${uid}/shows/${showId}`;

  const byRefA = await mediaCol
    .where("type", "==", "episode")
    .where("showRef", "==", refA)
    .get();

  const byRefB = await mediaCol
    .where("type", "==", "episode")
    .where("showRef", "==", refB)
    .get();

  // merge unique docs
  const seen = new Set<string>();
  const all: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  byRefA.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push(d);
    }
  });
  byRefB.forEach((d) => {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      all.push(d);
    }
  });

  let lastAddedAt: FirebaseFirestore.Timestamp | undefined;
  all.forEach((doc) => {
    const added = toTimestamp(doc.get("addedAt"));
    const updatedTs = toTimestamp(doc.get("updatedAt"));
    const candidate = added ?? updatedTs;
    if (candidate) {
      if (!lastAddedAt || candidate.toMillis() > lastAddedAt.toMillis()) {
        lastAddedAt = candidate;
      }
    }
  });

  return { episodeCount: all.length, lastAddedAt };
}

/**
 * POST body: { uid: string, batchSize?: number, startAfterShowId?: number }
 * Returns: { processed:number, created:number, updated:number, nextStartAfterShowId?:number }
 */
const handler = async (req: functions.https.Request, res: functions.Response) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method Not Allowed" });
        return;
      }

      const { uid, batchSize = 50, startAfterShowId } = req.body || {};
      if (!uid || typeof uid !== "string") {
        res.status(400).json({ error: "Missing uid" });
        return;
      }

      const mediaCol = db.collection(`users/${uid}/media`);

      // pull a large window and extract distinct show ids from showRef
      const windowSnap = await mediaCol
        .where("type", "==", "episode")
        .limit(2000)
        .get();

      const seen = new Set<number>();
      let allIds: number[] = [];
      windowSnap.forEach((doc) => {
        const showId = idFromShowRef(doc.get("showRef"));
        if (showId && !seen.has(showId)) {
          seen.add(showId);
          allIds.push(showId);
        }
      });

      // sort + paginate by numeric id if requested
      allIds.sort((a, b) => a - b);
      if (typeof startAfterShowId === "number") {
        allIds = allIds.filter((id) => id > startAfterShowId);
      }

      if (allIds.length === 0) {
        functions.logger.warn(
          "materializeUserShows: found 0 show ids via showRef",
          { uid, windowCount: windowSnap.size }
        );
        res.json({ processed: 0, created: 0, updated: 0 });
        return;
      }

      const batchIds = allIds.slice(0, batchSize);
      const nextStartAfter =
        allIds.length > batchIds.length ? batchIds[batchIds.length - 1] : undefined;

      let created = 0;
      let updated = 0;

      for (const tmdbShowId of batchIds) {
        // Count episodes + pick lastAddedAt
        const { episodeCount, lastAddedAt } = await countEpisodesForShow(
          mediaCol,
          uid,
          tmdbShowId
        );

        // Pull show metadata from global cache if present
        const cache: CachedShow | null = await getShowFromCache(tmdbShowId);

        const userShowRef = db.doc(`users/${uid}/shows/${tmdbShowId}`);
        const existingSnap = await userShowRef.get();
        const exists = existingSnap.exists;
        const existingData = (exists
          ? (existingSnap.data() as Partial<ShowDoc>)
          : {}) || {};

        // Base data (respect existing values)
        const base: Partial<ShowDoc> = {
          tmdbShowId,
          title: cache?.title || existingData.title || "Untitled Show",
          overview: cache?.overview ?? existingData.overview,
          genres: cache?.genres ?? existingData.genres,
          posterUrl: cache?.posterUrl ?? existingData.posterUrl ?? null,
          backdropUrl: cache?.backdropUrl ?? existingData.backdropUrl ?? null,
          episodeCount,
        };

        // Respect user overrides/locks
        if (existingData.posterLocked) delete base.posterUrl;
        if (existingData.backdropLocked) delete base.backdropUrl;
        if (existingData.displayTitle) delete base.title;

        const updates: FirebaseFirestore.UpdateData<ShowDoc> = {
          ...base,
          lastAddedAt:
            (lastAddedAt as any) ?? admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await userShowRef.set(updates, { merge: true });
        exists ? updated++ : created++;
      }

      res.json({
        processed: batchIds.length,
        created,
        updated,
        nextStartAfterShowId: nextStartAfter,
      });
    } catch (err: any) {
      functions.logger.error("materializeUserShows error", err);
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });
};

export default functions.https.onRequest(handler);