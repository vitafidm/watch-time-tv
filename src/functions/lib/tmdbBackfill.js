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
const tmdb_enrich_flow_1 = require("./flows/tmdb-enrich-flow");
if (!admin.apps.length)
    admin.initializeApp();
const corsHandler = (0, cors_1.default)({ origin: true });
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
function isNum(n) {
    return typeof n === "number" && Number.isFinite(n);
}
// Very forgiving filename -> showTitle fallback
function inferShowTitleFromFilename(name) {
    if (!name)
        return null;
    // strip extension
    const base = name.replace(/\.[a-z0-9]+$/i, "");
    // common patterns: "Show.Name.S01E02", "Show Name - s01e02", "Show (2019) - S01E02 - Title"
    const m = base.match(/^(.*?)\s*[\.\-\s_]*\(?\d{4}\)?\s*[\-\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)\s*[\-\.\s_]*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)\s*-\s*[sS]\d{1,2}[eE]\d{1,2}/) ||
        base.match(/^(.*?)[\.\s_]+S\d{1,2}E\d{1,2}/);
    const raw = (m?.[1] || base).trim();
    if (!raw)
        return null;
    // de-dot/de-slug
    return raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}
exports.default = functions
    .runWith({ timeoutSeconds: 540, memory: "1GB" })
    .https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== "POST") {
                return res
                    .status(405)
                    .json({ error: { status: "METHOD_NOT_ALLOWED", message: "Use POST" } });
            }
            // Auth (Firebase ID token from your Mac curl)
            const header = req.headers.authorization || "";
            if (!header.startsWith("Bearer ")) {
                return res.status(401).json({
                    error: {
                        status: "UNAUTHENTICATED",
                        message: "Missing Authorization: Bearer <ID_TOKEN>",
                    },
                });
            }
            const idToken = header.substring(7);
            const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
            if (!decoded?.uid) {
                return res
                    .status(401)
                    .json({ error: { status: "UNAUTHENTICATED", message: "Invalid ID token" } });
            }
            const uid = decoded.uid;
            const db = admin.firestore();
            const q = req.query || {};
            const b = (req.body || {});
            const typeParam = (b.type || q.type || "all");
            const limit = clamp(parseInt(String(b.limit ?? q.limit ?? "500"), 10) || 500, 1, 1000); // docs per Firestore page
            // HARD CAP at 50 because tmdbEnrich only accepts up to 50 items per call
            const batchSize = clamp(parseInt(String(b.batchSize ?? q.batchSize ?? "50"), 10) || 50, 1, 50);
            const processAll = String(b.processAll ?? q.processAll ?? "false").toLowerCase() === "true";
            const debug = String(b.debug ?? q.debug ?? "false").toLowerCase() === "true";
            let cursor = String(b.cursor ?? q.cursor ?? "");
            const started = Date.now();
            const SOFT_DEADLINE_MS = 470000; // ~7.8 min, under 540s limit
            let scanned = 0;
            let candidates = 0;
            let sentToEnrich = 0;
            let enriched = 0;
            let notFound = 0;
            let errors = 0;
            let skipped = 0;
            const preview = [];
            const coll = db.collection(`users/${uid}/media`);
            while (true) {
                let query = coll
                    .orderBy("updatedAt", "desc")
                    .orderBy(admin.firestore.FieldPath.documentId())
                    .limit(limit);
                if (cursor) {
                    const [msStr, docId] = cursor.split("|");
                    const ms = Number(msStr);
                    if (Number.isFinite(ms) && docId) {
                        query = query.startAfter(admin.firestore.Timestamp.fromMillis(ms), docId);
                    }
                }
                const snap = await query.get();
                if (snap.empty) {
                    cursor = "";
                    break;
                }
                scanned += snap.size;
                // Build enrichable items for this page
                const pageItems = [];
                for (const d of snap.docs) {
                    const m = (d.data() || {});
                    if (typeParam !== "all" && m.type !== typeParam)
                        continue;
                    const tmdbIdOk = typeof m.tmdbId === "number" && !Number.isNaN(m.tmdbId);
                    if (tmdbIdOk) {
                        skipped++;
                        continue;
                    }
                    if (m.type === "movie") {
                        const title = (m.normalizedTitle || m.title || m.filename || "").trim();
                        if (!title) {
                            if (debug)
                                preview.push({ mediaId: d.id, reason: "no_title" });
                            continue;
                        }
                        const year = isNum(m.year) ? m.year : undefined;
                        pageItems.push({ mediaId: d.id, type: "movie", title, year });
                    }
                    else if (m.type === "episode") {
                        const season = isNum(m.season) ? m.season : isNum(m.seasonNumber) ? m.seasonNumber : undefined;
                        const episode = isNum(m.episode) ? m.episode : isNum(m.episodeNumber) ? m.episodeNumber : undefined;
                        let showTitle = (m.showTitle || null);
                        // Try the referenced show doc if present
                        if (!showTitle && m.showRef && typeof m.showRef === "string") {
                            try {
                                const showSnap = await db.doc(m.showRef).get();
                                if (showSnap.exists) {
                                    const s = showSnap.data() || {};
                                    showTitle =
                                        s.normalizedTitle ||
                                            s.title ||
                                            s.filename ||
                                            s.name ||
                                            null;
                                }
                            }
                            catch {
                                // ignore
                            }
                        }
                        // Last resort: infer from filename/title
                        if (!showTitle) {
                            const raw = (m.filename || m.title || "").trim();
                            showTitle = inferShowTitleFromFilename(raw);
                        }
                        if (showTitle && isNum(season) && isNum(episode)) {
                            pageItems.push({
                                mediaId: d.id,
                                type: "episode", // <-- fixed
                                title: showTitle, // <-- fixed
                                season,
                                episode,
                            });
                        }
                        else if (debug) {
                            preview.push({
                                mediaId: d.id,
                                reason: "insufficient_episode_fields",
                                have: {
                                    showTitle,
                                    season,
                                    episode,
                                    filename: m.filename,
                                    title: m.title,
                                },
                            });
                        }
                    }
                }
                candidates += pageItems.length;
                // Enrich whole page in chunks of <= batchSize (and batchSize <= 50)
                for (let i = 0; i < pageItems.length; i += batchSize) {
                    const chunk = pageItems.slice(i, i + batchSize);
                    if (!chunk.length)
                        continue;
                    sentToEnrich += chunk.length;
                    const r = await (0, tmdb_enrich_flow_1.tmdbEnrichFlow)(uid, { items: chunk });
                    await new Promise(resolve => setTimeout(resolve, 10500));
                    const results = (r?.results || []);
                    for (const row of results) {
                        if (row.status === "enriched")
                            enriched++;
                        else if (row.status === "not_found")
                            notFound++;
                        else
                            errors++;
                    }
                    // Soft deadline guard: if processing everything, bail out with a cursor to resume
                    if (Date.now() - started > SOFT_DEADLINE_MS && processAll) {
                        const last = snap.docs[snap.docs.length - 1];
                        const lastTs = last?.get("updatedAt");
                        const tsMs = lastTs && typeof lastTs.toMillis === "function"
                            ? lastTs.toMillis()
                            : 0;
                        cursor = `${tsMs}|${last.id}`;
                        return res.status(200).json({
                            scanned,
                            candidates,
                            sentToEnrich,
                            enriched,
                            notFound,
                            skipped,
                            errors,
                            nextCursor: cursor,
                            ...(debug ? { preview } : {}),
                            info: "Soft deadline reached; resume with nextCursor.",
                        });
                    }
                }
                // Page cursor
                const last = snap.docs[snap.docs.length - 1];
                const lastTs = last?.get("updatedAt");
                const tsMs = lastTs && typeof lastTs.toMillis === "function" ? lastTs.toMillis() : 0;
                cursor = snap.size < limit ? "" : `${tsMs}|${last.id}`;
                if (!processAll)
                    break;
                if (!cursor)
                    break;
            }
            return res.status(200).json({
                scanned,
                candidates,
                sentToEnrich,
                enriched,
                notFound,
                skipped,
                errors,
                nextCursor: cursor || null,
                ...(debug ? { preview } : {}),
            });
        }
        catch (e) {
            functions.logger.error("tmdbBackfillMissing fatal", e);
            return res
                .status(500)
                .json({ error: { status: "INTERNAL", message: e?.message || "Internal error" } });
        }
    });
});
