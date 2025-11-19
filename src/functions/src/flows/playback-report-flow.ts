// src/functions/src/flows/playback-report-flow.ts
import * as admin from "firebase-admin";
import { z } from "zod";

const db = admin.firestore();

const ReportSchema = z.object({
  mediaId: z.string().min(1),
  position: z.number().min(0),
  duration: z.number().positive(),
  finished: z.boolean().optional(),
});

export type ReportInput = z.infer<typeof ReportSchema>;

/**
 * Helper: absolute path to a user's media collection.
 */
function userMediaCol(uid: string) {
  return db.collection(`users/${uid}/media`);
}

/**
 * Find the next episode within a show after (season, episode), in ascending order.
 * Returns the mediaId (preferred) or the document id if mediaId is missing.
 *
 * Query shape (requires composite index):
 *   where("type", "==", "episode")
 *   where("showRef", "==", showRefPath)
 *   orderBy("season", "asc")
 *   orderBy("episode", "asc")
 *   startAfter(season, episode)
 *   limit(1)
 */
async function findNextEpisodeMediaId(params: {
  uid: string;
  showRefPath: string;
  season: number;
  episode: number;
}): Promise<string | null> {
  const { uid, showRefPath, season, episode } = params;

  const q = userMediaCol(uid)
    .where("type", "==", "episode")
    .where("showRef", "==", showRefPath)
    .orderBy("season", "asc")
    .orderBy("episode", "asc")
    // NOTE: startAfter with field values must match the orderBy fields
    .startAfter(season, episode)
    .limit(1);

  const snap = await q.get();
  const doc = snap.docs[0];
  if (!doc) return null;

  const d = doc.data() || {};
  return (typeof d.mediaId === "string" && d.mediaId) || doc.id;
}

export async function playbackReportFlow(uid: string, body: unknown) {
  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    const e = new Error(JSON.stringify(parsed.error.issues));
    (e as any).code = "invalid-argument";
    throw e;
  }

  const { mediaId, position, duration, finished } = parsed.data;

  // Refs used below
  const pbRef = db.doc(`users/${uid}/playback/${mediaId}`);
  const mediaRef = db.doc(`users/${uid}/media/${mediaId}`);

  // Read media doc FIRST (outside the transaction) to:
  // - validate existence
  // - determine episode vs movie
  // - harvest showRef/season/episode for nextUp computation
  const mediaSnap = await mediaRef.get();
  if (!mediaSnap.exists) {
    const e = new Error("Media not found.");
    (e as any).code = "failed-precondition";
    throw e;
  }
  const mediaData = mediaSnap.data() || {};

  const isEpisode = mediaData?.type === "episode";
  const showRefPath: string | null =
    isEpisode && typeof mediaData?.showRef === "string" ? mediaData.showRef : null;
  const seasonNum: number | null =
    isEpisode && typeof mediaData?.season === "number" ? mediaData.season : null;
  const episodeNum: number | null =
    isEpisode && typeof mediaData?.episode === "number" ? mediaData.episode : null;

  const finishThreshold = Math.max(1, Math.floor(0.9 * duration)); // 90%
  const isFinished = !!finished;

  // If we are finishing an EPISODE, pre-compute nextUpEpisodeId outside txn (uses a query).
  // This avoids mixing query reads inside the write txn.
  let nextUpEpisodeId: string | null = null;
  if (isFinished && isEpisode && showRefPath && seasonNum != null && episodeNum != null) {
    try {
      nextUpEpisodeId = await findNextEpisodeMediaId({
        uid,
        showRefPath,
        season: seasonNum,
        episode: episodeNum,
      });
    } catch {
      // best-effort — nextUp remains null if query fails
      nextUpEpisodeId = null;
    }
  }

  await db.runTransaction(async (tx) => {
    // Read playback doc to satisfy transaction read requirements
    await tx.get(pbRef);

    const now = admin.firestore.FieldValue.serverTimestamp();

    if (!isFinished) {
      // Upsert playback progress
      tx.set(
        pbRef,
        {
          mediaId,
          lastPosition: position,
          duration,
          lastPlayedAt: now,
        },
        { merge: true }
      );

      // Mirror per-episode progress onto the parent show for instant "Play" from poster
      if (isEpisode && showRefPath) {
        const showRef = db.doc(showRefPath);
        tx.set(
          showRef,
          {
            lastPlayedEpisodeId: mediaId,
            lastPlayedPosition: position,
            lastPlayedDuration: duration,
            lastPlayedAt: now,
          },
          { merge: true }
        );
      }

      return;
    }

    // FINISH PATH
    // Debounce playCount increment (same as your prior logic)
    const lastFinishedAtMillis =
      typeof (mediaData as any).lastFinishedAt?.toMillis === "function"
        ? (mediaData as any).lastFinishedAt.toMillis()
        : 0;
    const canIncrement = lastFinishedAtMillis < Date.now() - 60_000;

    if (canIncrement) {
      tx.update(mediaRef, {
        playCount: admin.firestore.FieldValue.increment(1),
        lastFinishedAt: now,
      });
    } else {
      tx.update(mediaRef, { lastFinishedAt: now });
    }

    // Remove the per-media playback record
    tx.delete(pbRef);

    // Update show progress pointers (episode only)
    if (isEpisode && showRefPath) {
      const showRef = db.doc(showRefPath);

      const showPatch: Record<string, any> = {
        lastCompletedEpisodeId: mediaId,
        lastCompletedAt: now,
      };

      if (nextUpEpisodeId) {
        // We have a next episode → set nextUp and clear lastPlayedPosition (start next at 0)
        showPatch.nextUpEpisodeId = nextUpEpisodeId;
        showPatch.lastPlayedEpisodeId = nextUpEpisodeId;
        showPatch.lastPlayedPosition = 0;
        showPatch.lastPlayedDuration = admin.firestore.FieldValue.delete();
        showPatch.lastPlayedAt = now;
      } else {
        // No next episode → clear nextUp and clear "lastPlayed*"
        showPatch.nextUpEpisodeId = null;
        showPatch.lastPlayedEpisodeId = null;
        showPatch.lastPlayedPosition = null;
        showPatch.lastPlayedDuration = null;
        showPatch.lastPlayedAt = now;
      }

      tx.set(showRef, showPatch, { merge: true });
    }
  });

  return { ok: true };
}
