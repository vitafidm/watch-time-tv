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
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = __importDefault(require("crypto"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const corsHandler = (0, cors_1.default)({ origin: true });
function normalizeTitle(raw) {
    return (raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Deterministic showId from folder name.
 * If you later decide to include serverId in the key, change the seed to `${norm}|${serverId}`.
 */
function showIdFromFolder(folderName) {
    const norm = normalizeTitle(folderName);
    return crypto_1.default.createHash("sha1").update(norm).digest("hex").slice(0, 40);
}
/**
 * Given a full file path, return the *show-level* folder info:
 * - showFolderName: the folder name that represents the show
 * - showFolderPath: the full path up to that folder (not including the file), e.g. /.../TV/Animaniacs
 *
 * Handles both:
 *   /TV/Animaniacs/Animaniacs.S04E06.mp4               -> showFolderName = Animaniacs
 *   /TV/Animaniacs/Season 1/Animaniacs.S01E01.mp4      -> showFolderName = Animaniacs
 *   /TV/Bridgerton/S02/Bridgerton.S02E01.mkv           -> showFolderName = Bridgerton
 */
function extractShowFolder(path) {
    if (!path || typeof path !== "string")
        return null;
    // Split and drop empty parts
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2)
        return null;
    // last segment is file name
    const fileName = parts[parts.length - 1];
    const parent = parts[parts.length - 2] || "";
    const grandparent = parts.length >= 3 ? parts[parts.length - 3] : "";
    // Season folder regex:
    //  - "Season 1", "Season 01", "Season 1 (1080p)"
    //  - "S01", "S1"
    //  - "Series 2"
    const seasonRegex = /^(season\s*\d+(\s*\(.*\))?|s\d+|series\s*\d+)$/i;
    let showFolderName = parent;
    let showFolderPathParts = parts.slice(0, -1); // default: up to parent folder
    if (seasonRegex.test(parent) && grandparent) {
        // If the immediate parent is a season folder, step up a level for show folder
        showFolderName = grandparent;
        showFolderPathParts = parts.slice(0, -2); // up to grandparent
    }
    const showFolderPath = "/" + showFolderPathParts.join("/");
    return { showFolderName, showFolderPath };
}
function toTimestamp(v) {
    if (!v)
        return null;
    // Firestore Timestamp already
    if (typeof v?.toMillis === "function" && typeof v?.toDate === "function") {
        return v;
    }
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? admin.firestore.Timestamp.fromDate(d) : null;
}
exports.default = functions
    .runWith({ timeoutSeconds: 540, memory: "1GB" })
    .https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res.status(405).json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" } });
            }
            // Auth: require Firebase ID token (same pattern as your other functions)
            const header = req.headers.authorization || "";
            if (!header.startsWith("Bearer ")) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Missing Authorization header" } });
            }
            const idToken = header.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid) {
                return res.status(401).json({ error: { status: "UNAUTHENTICATED", message: "Invalid ID token" } });
            }
            const uid = decoded.uid;
            // Controls (you can override from client/CLI)
            const { pageSize = 400, // how many episode docs per page to scan
            processAll = true, // keep paging until exhausted
            cursor, // opaque cursor from previous call
            debug = false, } = (req.body || {});
            // Build base collection + cursor
            const mediaCol = db.collection(`users/${uid}/media`);
            const PAGE_LIMIT = Math.max(50, Math.min(1000, Number(pageSize) || 400));
            let nextCursor = (typeof cursor === "string" && cursor) ? cursor : null;
            let scanned = 0;
            let episodesTouched = 0;
            let showsUpserted = 0;
            let showsRecounted = 0;
            const started = Date.now();
            const SOFT_DEADLINE_MS = 470000; // finish before 540s limit
            // One paging loop (you can call repeatedly using returned nextCursor)
            while (true) {
                let q = mediaCol
                    .where("type", "==", "episode")
                    .orderBy("updatedAt", "desc")
                    .orderBy(admin.firestore.FieldPath.documentId())
                    .limit(PAGE_LIMIT);
                if (nextCursor) {
                    const [msStr, docId] = String(nextCursor).split("|");
                    const ms = Number(msStr);
                    if (Number.isFinite(ms) && docId) {
                        q = q.startAfter(admin.firestore.Timestamp.fromMillis(ms), docId);
                    }
                }
                const snap = await q.get();
                if (snap.empty) {
                    nextCursor = null;
                    break;
                }
                scanned += snap.size;
                const byShowId = new Map();
                for (const doc of snap.docs) {
                    const data = doc.data() || {};
                    const path = data.path || "";
                    const extracted = extractShowFolder(path);
                    if (!extracted)
                        continue; // skip weird paths
                    const folderName = extracted.showFolderName;
                    const showFolderPath = extracted.showFolderPath;
                    const showId = showIdFromFolder(folderName);
                    const serverId = typeof data.serverId === "string" ? data.serverId : null;
                    const bucket = byShowId.get(showId) || {
                        folderName,
                        showId,
                        episodeDocs: [],
                        lastAddedAt: null,
                        serverId,
                        exampleShowFolderPath: showFolderPath,
                    };
                    // compute latest addedAt for this bucket (fallback to updatedAt)
                    const addedAtTs = toTimestamp(data.addedAt) || toTimestamp(data.updatedAt);
                    if (addedAtTs) {
                        if (!bucket.lastAddedAt || addedAtTs.toMillis() > bucket.lastAddedAt.toMillis()) {
                            bucket.lastAddedAt = addedAtTs;
                        }
                    }
                    bucket.episodeDocs.push(doc);
                    byShowId.set(showId, bucket);
                }
                // 1) Upsert per-show doc (titleCandidate from folder), link back showRef/showTitle on episodes
                for (const bucket of byShowId.values()) {
                    const showRef = db.doc(`users/${uid}/shows/${bucket.showId}`);
                    const showSnap = await showRef.get();
                    const exists = showSnap.exists;
                    const showData = (exists ? (showSnap.data() || {}) : {});
                    const toSet = {
                        title: showData.title || bucket.folderName, // keep existing nice title if present
                        titleCandidate: bucket.folderName, // raw folder
                        normalizedTitle: normalizeTitle(bucket.folderName),
                        folderPath: showData.folderPath || bucket.exampleShowFolderPath || null,
                        serverId: showData.serverId || bucket.serverId || null,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    };
                    // Don’t clobber user-locked visuals if you use locks elsewhere
                    if (showData.posterLocked)
                        delete toSet.posterUrl;
                    if (showData.backdropLocked)
                        delete toSet.backdropUrl;
                    await showRef.set(toSet, { merge: true });
                    if (!exists)
                        showsUpserted++;
                    // Link each episode to this showRef (idempotent merge)
                    const showRefPath = showRef.path; // "users/{uid}/shows/{showId}"
                    const batch = db.batch();
                    let ops = 0;
                    for (const epDoc of bucket.episodeDocs) {
                        const ep = epDoc.data() || {};
                        const existingRef = typeof ep.showRef === "string" ? ep.showRef : null;
                        const existingTitle = typeof ep.showTitle === "string" ? ep.showTitle : null;
                        const needsWrite = existingRef !== showRefPath || !existingTitle || existingTitle !== bucket.folderName;
                        if (needsWrite) {
                            batch.set(epDoc.ref, { showRef: showRefPath, showTitle: bucket.folderName }, { merge: true });
                            ops++;
                        }
                        // Commit every ~400 ops to stay under 500 write/commit limits
                        if (ops >= 400) {
                            await batch.commit();
                            ops = 0;
                        }
                    }
                    if (ops > 0)
                        await batch.commit();
                    episodesTouched += bucket.episodeDocs.length;
                }
                // 2) Recalculate episodeCount for each showId in this page (accurate & idempotent)
                for (const bucket of byShowId.values()) {
                    const showRefPath = `users/${uid}/shows/${bucket.showId}`;
                    const countSnap = await mediaCol
                        .where("type", "==", "episode")
                        .where("showRef", "==", showRefPath)
                        .select() // only ids
                        .get();
                    const episodeCount = countSnap.size;
                    await db.doc(showRefPath).set({
                        episodeCount,
                        lastAddedAt: bucket.lastAddedAt || admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    showsRecounted++;
                }
                // Paging
                const last = snap.docs[snap.docs.length - 1];
                const lastTs = last?.get("updatedAt");
                const tsMs = lastTs && typeof lastTs?.toMillis === "function" ? lastTs.toMillis() : Date.now();
                nextCursor = snap.size < PAGE_LIMIT ? null : `${tsMs}|${last.id}`;
                // Soft deadline -> return a cursor so UI can resume
                if (Date.now() - started > SOFT_DEADLINE_MS) {
                    return res.status(200).json({
                        scanned,
                        episodesTouched,
                        showsUpserted,
                        showsRecounted,
                        nextCursor,
                        info: "Soft deadline reached; resume with nextCursor.",
                        ...(debug ? { pageBuckets: byShowId.size } : {}),
                    });
                }
                if (!processAll || !nextCursor)
                    break;
            }
            return res.status(200).json({
                scanned,
                episodesTouched,
                showsUpserted,
                showsRecounted,
                nextCursor: nextCursor || null,
            });
        }
        catch (e) {
            functions.logger.error("materializeUserShowsFromFolders fatal", e);
            return res.status(500).json({ error: { status: "INTERNAL", message: e?.message || "Internal error" } });
        }
    });
});
