
import * as admin from "firebase-admin";
import { z } from "zod";

const db = admin.firestore();

const ReportSchema = z.object({
  mediaId: z.string().min(1),
  position: z.number().min(0),
  duration: z.number().positive(),
  finished: z.boolean().optional()
});

export type ReportInput = z.infer<typeof ReportSchema>;

export async function playbackReportFlow(uid: string, body: unknown) {
  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    const e = new Error(JSON.stringify(parsed.error.issues));
    (e as any).code = "invalid-argument";
    throw e;
  }
  const { mediaId, position, duration, finished } = parsed.data;

  const pbRef = db.doc(`users/${uid}/playback/${mediaId}`);
  const mediaRef = db.doc(`users/${uid}/media/${mediaId}`);
  const finishThreshold = Math.max(1, Math.floor(0.9 * duration)); // 90%

  await db.runTransaction(async (tx) => {
    const pbSnap = await tx.get(pbRef);
    const mediaSnap = await tx.get(mediaRef);

    if (!mediaSnap.exists) {
      const e = new Error("Media not found.");
      (e as any).code = "failed-precondition";
      throw e;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const isFinished = !!finished || position >= finishThreshold;

    if (!isFinished) {
      tx.set(
        pbRef,
        {
          mediaId,
          lastPosition: position,
          duration,
          lastPlayedAt: now
        },
        { merge: true }
      );
      return;
    }

    const mediaData = mediaSnap.data() || {};
    const canIncrement =
      !mediaData.lastFinishedAt ||
      (mediaData.lastFinishedAt.toMillis?.() ?? 0) < Date.now() - 60_000;

    if (canIncrement) {
      tx.update(mediaRef, {
        playCount: admin.firestore.FieldValue.increment(1),
        lastFinishedAt: now
      });
    } else {
      tx.update(mediaRef, { lastFinishedAt: now });
    }

    tx.delete(pbRef);
  });

  return { ok: true };
}
