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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = __importStar(require("firebase-functions"));
const cors_1 = __importDefault(require("cors"));
const admin = __importStar(require("firebase-admin"));
const initFirebase_1 = require("./initFirebase");
const showCache_1 = require("./showCache");
const corsHandler = (0, cors_1.default)({ origin: true });
function toTimestamp(v) {
    if (!v)
        return undefined;
    if (v.toDate && v.toMillis)
        return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : admin.firestore.Timestamp.fromDate(d);
}
// pull numeric id from showRef: "shows/4586" OR "/users/<uid>/shows/4586"
function idFromShowRef(showRef) {
    if (typeof showRef !== "string")
        return null;
    // match "shows/12345" OR "/.../shows/12345"
    const m = showRef.match(/(?:^|\/)shows\/(\d+)/);
    return m ? Number(m[1]) : null;
}
// count episodes for a given show id using showRef equality
async function countEpisodesForShow(mediaCol, uid, showId) {
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
    const seen = new Set();
    const all = [];
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
    let lastAddedAt;
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
const handler = async (req, res) => {
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
            const mediaCol = initFirebase_1.db.collection(`users/${uid}/media`);
            // pull a large window and extract distinct show ids from showRef
            const windowSnap = await mediaCol
                .where("type", "==", "episode")
                .limit(2000)
                .get();
            const seen = new Set();
            let allIds = [];
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
                functions.logger.warn("materializeUserShows: found 0 show ids via showRef", { uid, windowCount: windowSnap.size });
                res.json({ processed: 0, created: 0, updated: 0 });
                return;
            }
            const batchIds = allIds.slice(0, batchSize);
            const nextStartAfter = allIds.length > batchIds.length ? batchIds[batchIds.length - 1] : undefined;
            let created = 0;
            let updated = 0;
            for (const tmdbShowId of batchIds) {
                // Count episodes + pick lastAddedAt
                const { episodeCount, lastAddedAt } = await countEpisodesForShow(mediaCol, uid, tmdbShowId);
                // Pull show metadata from global cache if present
                const cache = await (0, showCache_1.getShowFromCache)(tmdbShowId);
                const userShowRef = initFirebase_1.db.doc(`users/${uid}/shows/${tmdbShowId}`);
                const existingSnap = await userShowRef.get();
                const exists = existingSnap.exists;
                const existingData = (exists
                    ? existingSnap.data()
                    : {}) || {};
                // Base data (respect existing values)
                const base = {
                    tmdbShowId,
                    title: cache?.title || existingData.title || "Untitled Show",
                    overview: cache?.overview ?? existingData.overview,
                    genres: cache?.genres ?? existingData.genres,
                    posterUrl: cache?.posterUrl ?? existingData.posterUrl ?? null,
                    backdropUrl: cache?.backdropUrl ?? existingData.backdropUrl ?? null,
                    episodeCount,
                };
                // Respect user overrides/locks
                if (existingData.posterLocked)
                    delete base.posterUrl;
                if (existingData.backdropLocked)
                    delete base.backdropUrl;
                if (existingData.displayTitle)
                    delete base.title;
                const updates = {
                    ...base,
                    lastAddedAt: lastAddedAt ?? admin.firestore.FieldValue.serverTimestamp(),
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
        }
        catch (err) {
            functions.logger.error("materializeUserShows error", err);
            res.status(500).json({ error: err?.message || "Internal error" });
        }
    });
};
exports.default = functions.https.onRequest(handler);
