"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.playbackReportFlow = playbackReportFlow;
// src/functions/src/flows/playback-report-flow.ts
const admin = __importStar(require("firebase-admin"));
const zod_1 = require("zod");
const db = admin.firestore();
const ReportSchema = zod_1.z.object({
    mediaId: zod_1.z.string().min(1),
    position: zod_1.z.number().min(0),
    duration: zod_1.z.number().positive(),
    finished: zod_1.z.boolean().optional(),
});
/**
 * Helper: absolute path to a user's media collection.
 */
function userMediaCol(uid) {
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
async function findNextEpisodeMediaId(params) {
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
    if (!doc)
        return null;
    const d = doc.data() || {};
    return (typeof d.mediaId === "string" && d.mediaId) || doc.id;
}
async function playbackReportFlow(uid, body) {
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) {
        const e = new Error(JSON.stringify(parsed.error.issues));
        e.code = "invalid-argument";
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
        e.code = "failed-precondition";
        throw e;
    }
    const mediaData = mediaSnap.data() || {};
    const isEpisode = mediaData?.type === "episode";
    const showRefPath = isEpisode && typeof mediaData?.showRef === "string" ? mediaData.showRef : null;
    const seasonNum = isEpisode && typeof mediaData?.season === "number" ? mediaData.season : null;
    const episodeNum = isEpisode && typeof mediaData?.episode === "number" ? mediaData.episode : null;
    const finishThreshold = Math.max(1, Math.floor(0.9 * duration)); // 90%
    const isFinished = !!finished;
    // If we are finishing an EPISODE, pre-compute nextUpEpisodeId outside txn (uses a query).
    // This avoids mixing query reads inside the write txn.
    let nextUpEpisodeId = null;
    if (isFinished && isEpisode && showRefPath && seasonNum != null && episodeNum != null) {
        try {
            nextUpEpisodeId = await findNextEpisodeMediaId({
                uid,
                showRefPath,
                season: seasonNum,
                episode: episodeNum,
            });
        }
        catch {
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
            tx.set(pbRef, {
                mediaId,
                lastPosition: position,
                duration,
                lastPlayedAt: now,
            }, { merge: true });
            // Mirror per-episode progress onto the parent show for instant "Play" from poster
            if (isEpisode && showRefPath) {
                const showRef = db.doc(showRefPath);
                tx.set(showRef, {
                    lastPlayedEpisodeId: mediaId,
                    lastPlayedPosition: position,
                    lastPlayedDuration: duration,
                    lastPlayedAt: now,
                }, { merge: true });
            }
            return;
        }
        // FINISH PATH
        // Debounce playCount increment (same as your prior logic)
        const lastFinishedAtMillis = typeof mediaData.lastFinishedAt?.toMillis === "function"
            ? mediaData.lastFinishedAt.toMillis()
            : 0;
        const canIncrement = lastFinishedAtMillis < Date.now() - 60000;
        if (canIncrement) {
            tx.update(mediaRef, {
                playCount: admin.firestore.FieldValue.increment(1),
                lastFinishedAt: now,
            });
        }
        else {
            tx.update(mediaRef, { lastFinishedAt: now });
        }
        // Remove the per-media playback record
        tx.delete(pbRef);
        // Update show progress pointers (episode only)
        if (isEpisode && showRefPath) {
            const showRef = db.doc(showRefPath);
            const showPatch = {
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
            }
            else {
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
