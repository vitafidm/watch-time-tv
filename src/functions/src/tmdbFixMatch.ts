// functions/tmdbFixMatch.ts
import * as functions from "firebase-functions";
import cors from "cors";
import * as admin from "firebase-admin";
import crypto from "crypto";
import { db } from "./initFirebase";
import { pickYouTubeTrailer } from "./titleHelpers";
import { movieDetails, tvDetails, posterUrl, backdropUrl } from "./tmdbClient";

const corsHandler = cors({ origin: true });

/** ---------- Extra videos: normalized shape ---------- **/
type ExtraVideo = {
  id: string;
  key: string;
  name: string | null;
  site: string | null;
  type: string | null;
  official: boolean;
  size: number | null;
};

function normalizeExtraVideos(raw: any[] | undefined): ExtraVideo[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const mapped = raw
    .map((v: any): ExtraVideo | null => {
      const key = typeof v?.key === "string" ? v.key : "";
      const site = typeof v?.site === "string" ? v.site : "";
      if (!key || !site) return null;

      return {
        id: String(v.id ?? `${site}:${key}`),
        key,
        name: typeof v?.name === "string" ? v.name : null,
        site,
        type: typeof v?.type === "string" ? v.type : null,
        official: Boolean(v?.official),
        size: typeof v?.size === "number" ? v.size : null,
      };
    })
    .filter(Boolean) as ExtraVideo[];

  return mapped.length ? mapped : null;
}

/** ---------- Logo helpers ---------- **/
type TmdbLogo = {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number | null;
  vote_count?: number | null;
};

function pickBestLogoFromDetails(details: any): string | null {
  const logos: TmdbLogo[] | undefined = details?.images?.logos;
  if (!Array.isArray(logos) || logos.length === 0) return null;

  const sorted = [...logos].sort(
    (a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0)
  );

  const preferredLangs: (string | null)[] = [
    details?.original_language ?? null,
    "en",
  ];

  for (const lang of preferredLangs) {
    if (!lang) continue;
    const hit = sorted.find((l) => l.iso_639_1 === lang && l.file_path);
    if (hit?.file_path) {
      return backdropUrl(hit.file_path, "original");
    }
  }

  const first = sorted.find((l) => l.file_path);
  return first?.file_path ? backdropUrl(first.file_path, "original") : null;
}

/** ---------- Helpers to resolve canonical show doc ---------- **/
function normalizeTitle(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function showIdFromFolder(folderName: string): string {
  const norm = normalizeTitle(folderName);
  return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 40);
}

/**
 * Given a full file path, return the *show-level* folder info:
 * - showFolderName: the folder name that represents the show
 * - showFolderPath: the full path up to that folder (not including the file), e.g. /.../TV/Animaniacs
 *
 * Handles both:
 *   /TV/Animaniacs/Animaniacs.S04E06.mp4
 *   /TV/Animaniacs/Season 1/Animaniacs.S01E01.mp4
 *   /TV/Bridgerton/S02/Bridgerton.S02E01.mkv
 */
function extractShowFolder(
  path: string
): { showFolderName: string; showFolderPath: string } | null {
  if (!path || typeof path !== "string") return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const parent = parts[parts.length - 2] || "";
  const grandparent = parts.length >= 3 ? parts[parts.length - 3] : "";

  // "Season 1", "S01", "Series 2", etc.
  const seasonRegex = /^(season\s*\d+(\s*\(.*\))?|s\d+|series\s*\d+)$/i;

  let showFolderName = parent;
  let showFolderPathParts = parts.slice(0, -1);

  if (seasonRegex.test(parent) && grandparent) {
    showFolderName = grandparent;
    showFolderPathParts = parts.slice(0, -2);
  }

  const showFolderPath = "/" + showFolderPathParts.join("/");
  return { showFolderName, showFolderPath };
}

/** ---------- Merge helper respects user locks & preserves existing fields ---------- **/
function mergeShowWithLocks(existing: any, incoming: any) {
  // Start with existing so fs-derived fields (folderPath, serverId, episodeCount, etc.) persist
  const merged: Record<string, any> = {
    ...existing,
    ...incoming,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (existing?.posterLocked) merged.posterUrl = existing.posterUrl;
  if (existing?.backdropLocked) merged.backdropUrl = existing.backdropUrl;
  if (existing?.videoLocked) merged.videoLink = existing.videoLink;
  if (existing?.logoLocked) merged.logoUrl = existing.logoUrl;

  return merged;
}

/** ---------- MOVIE FIX ---------- **/
async function handleMovieFix(
  docRef: FirebaseFirestore.DocumentReference,
  tmdbId: number,
  includeCast: boolean
) {
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Document not found.");
  }

  const existing = snap.data() || {};
  const details = await movieDetails(tmdbId);
  if (!details) {
    throw new functions.https.HttpsError(
      "not-found",
      `Could not fetch movie details for TMDB ID ${tmdbId}.`
    );
  }

  const extraVideos =
    normalizeExtraVideos(details.videos?.results) ??
    (existing.extraVideos ?? null);
  const logoUrlFromTmdb = pickBestLogoFromDetails(details) ?? existing.logoUrl ?? null;

  const incoming: Record<string, any> = {
    tmdbId: details.id,
    tmdbType: "movie",
    title: details.title,
    normalizedTitle: details.title,
    overview: details.overview ?? null,
    releaseDate: details.release_date ?? null,
    genres: (details.genres || []).map((g: any) => g?.name).filter(Boolean),
    director:
      details.credits?.crew?.find((c: any) => c?.job === "Director")?.name || null,
    voteAverage: details.vote_average ?? null,
    language: details.original_language ?? null,
    posterUrl: posterUrl(details.poster_path, "w500"),
    backdropUrl: backdropUrl(details.backdrop_path, "original"),
    videoLink: pickYouTubeTrailer(details.videos?.results),
    logoUrl: logoUrlFromTmdb,
    extraVideos,
  };

  if (includeCast) {
    incoming.cast = (details.credits?.cast || [])
      .slice(0, 10)
      .map((c: any) => ({
        name: c?.name || "",
        character: c?.character || "",
        profileUrl: posterUrl(c?.profile_path, "w185"),
      }));
  }

  const merged = mergeShowWithLocks(existing, incoming);
  await docRef.set(merged, { merge: true });

  return { ok: true, docId: docRef.id, kind: "movie", tmdbId };
}

/** ---------- TV / EPISODE FIX (canonical, path-aware) ---------- **/
async function handleTVEpisodeFix(
  episodeRef: FirebaseFirestore.DocumentReference,
  tmdbShowId: number,
  includeCast: boolean
) {
  const epSnap = await episodeRef.get();
  if (!epSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Episode document not found.");
  }
  const ep = epSnap.data() || {};

  const showDetails = await tvDetails(tmdbShowId);
  if (!showDetails) {
    throw new functions.https.HttpsError(
      "not-found",
      `Could not fetch TV show details for TMDB ID ${tmdbShowId}.`
    );
  }

  // Determine user id from path
  const uid = episodeRef.parent?.parent?.id;
  if (!uid) {
    throw new functions.https.HttpsError(
      "internal",
      "Could not determine user id from path."
    );
  }

  // 1) Resolve the *canonical* show doc ref
  // Prefer episode.showRef if it points to users/{uid}/shows/{folderHash}
  const epShowRef: string | null =
    typeof ep.showRef === "string" ? ep.showRef : null;

  let targetShowRef: FirebaseFirestore.DocumentReference;
  let derivedFrom = "showRef";

  if (epShowRef && epShowRef.startsWith(`users/${uid}/shows/`)) {
    targetShowRef = db.doc(epShowRef);
  } else {
    // Derive from filesystem path (canonical)
    const epPath: string | null = typeof ep.path === "string" ? ep.path : null;
    let showId: string | null = null;
    let folderPathForDoc: string | null = null;

    if (epPath) {
      const extracted = extractShowFolder(epPath);
      if (extracted) {
        showId = showIdFromFolder(extracted.showFolderName);
        folderPathForDoc = extracted.showFolderPath;
        derivedFrom = "path";
      }
    }

    // Fallback: derive from showTitle if path missing
    if (!showId) {
      const titleCandidate: string | null =
        (typeof ep.showTitle === "string" && ep.showTitle) ||
        null;
      if (titleCandidate) {
        showId = showIdFromFolder(titleCandidate);
        derivedFrom = "showTitle";
      }
    }

    // Last resort (rare): if we cannot derive canonical id at all,
    // still avoid creating /shows/{tmdbId} docs by using a deterministic ID from TMDB title
    if (!showId) {
      const fallbackName =
        showDetails.name || showDetails.original_name || String(tmdbShowId);
      showId = showIdFromFolder(fallbackName);
      derivedFrom = "tmdbNameFallback";
    }

    targetShowRef = db.doc(`users/${uid}/shows/${showId}`);

    // If this is a brand-new doc, seed minimal fs fields so we don’t lose them
    const seed: Record<string, any> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (folderPathForDoc) seed.folderPath = folderPathForDoc;
    if (typeof ep.serverId === "string") seed.serverId = ep.serverId;
    // Ensure tmdbShowId field exists (null or value) for future queries if needed
    if (typeof (await targetShowRef.get()).data()?.tmdbShowId === "undefined") {
      seed.tmdbShowId = null;
    }
    await targetShowRef.set(seed, { merge: true });
  }

  // 2) Merge rich TMDB data into the canonical show doc
  const showSnap = await targetShowRef.get();
  const existingShow = showSnap.exists ? showSnap.data() || {} : {};

  const extraVideos =
    normalizeExtraVideos(showDetails.videos?.results) ??
    (existingShow.extraVideos ?? null);
  const logoUrlFromTmdb =
    pickBestLogoFromDetails(showDetails) ?? existingShow.logoUrl ?? null;

  const incomingShow: Record<string, any> = {
    tmdbShowId: showDetails.id, // store ID as field, not doc id
    tmdbType: "tv",
    title: showDetails.name ?? existingShow.title ?? null,
    normalizedTitle: showDetails.name ?? existingShow.normalizedTitle ?? null,
    overview: showDetails.overview ?? null,
    genres: (showDetails.genres || []).map((g: any) => g?.name).filter(Boolean),
    firstAirDate: showDetails.first_air_date ?? null,
    voteAverage: showDetails.vote_average ?? null,
    language: showDetails.original_language ?? null,
    posterUrl: posterUrl(showDetails.poster_path, "w500"),
    backdropUrl: backdropUrl(showDetails.backdrop_path, "original"),
    logoUrl: logoUrlFromTmdb,
    extraVideos,
  };

  if (includeCast) {
    incomingShow.cast = (showDetails.aggregate_credits?.cast || [])
      .slice(0, 10)
      .map((c: any) => ({
        name: c?.name || "",
        character:
          (Array.isArray(c?.roles)
            ? c.roles.map((r: any) => r?.character).filter(Boolean).join(", ")
            : c?.character) || "",
        profileUrl: posterUrl(c?.profile_path, "w185"),
      }));
  }

  const mergedShow = mergeShowWithLocks(existingShow, incomingShow);
  await targetShowRef.set(mergedShow, { merge: true });

  // 3) Update the episode doc (respect its own locks)
  const episodeUpdate: Record<string, any> = {
    showRef: targetShowRef.path, // canonical path
    tmdbShowId: showDetails.id,
    showTitle: mergedShow.title || showDetails.name || null,
    overview: mergedShow.overview ?? showDetails.overview ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // optional for debugging:
    __fixMatchShowRefSource: derivedFrom,
  };
  if (!ep?.posterLocked) episodeUpdate.posterUrl = mergedShow.posterUrl ?? null;
  if (!ep?.backdropLocked) episodeUpdate.backdropUrl = mergedShow.backdropUrl ?? null;
  // (We keep logoUrl/extraVideos show-level; episode docs can read via showRef.)

  await episodeRef.set(episodeUpdate, { merge: true });

  return {
    ok: true,
    docId: episodeRef.id,
    kind: "tv",
    tmdbId: tmdbShowId,
    showRef: targetShowRef.path,
    derivedFrom,
  };
}

/** ---------- ENTRYPOINT ---------- **/
export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated."
        );
      }
      // (Optional) verify token/uid if you want to enforce ownership

      const { collection, docId, kind, tmdbId, includeCast = true } = req.body || {};
      if (!collection || !docId || !kind || !tmdbId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing required fields: collection, docId, kind, tmdbId."
        );
      }

      const docRef = db.doc(`${collection}/${docId}`);

      let result;
      if (String(kind) === "movie") {
        result = await handleMovieFix(docRef, Number(tmdbId), Boolean(includeCast));
      } else if (["tv", "show", "episode"].includes(String(kind))) {
        result = await handleTVEpisodeFix(
          docRef,
          Number(tmdbId),
          Boolean(includeCast)
        );
      } else {
        throw new functions.https.HttpsError(
          "invalid-argument",
          'Invalid "kind" specified. Must be "movie" or "tv"/"show"/"episode".'
        );
      }

      res.status(200).json(result);
    } catch (error: any) {
      functions.logger.error("Error in tmdbFixMatch:", error);
      const code = error?.code || "internal";
      const message = error?.message || "An internal error occurred.";
      const status =
        code === "unauthenticated"
          ? 401
          : code === "not-found"
          ? 404
          : code === "invalid-argument"
          ? 400
          : 500;
      res.status(status).json({ error: { code, message } });
    }
  });
});
