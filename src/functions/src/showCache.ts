// functions/src/showCache.ts (or ./showCache.ts wherever it lives)
import * as admin from "firebase-admin";
import { db } from "./initFirebase";
import { tvDetails, posterUrl, backdropUrl } from "./tmdbClient";

// Keep this in sync (shape-wise) with any ExtraVideo type you use elsewhere.
export type ExtraVideoKind =
  | "trailer"
  | "teaser"
  | "clip"
  | "behind_the_scenes"
  | "featurette"
  | "bloopers"
  | "opening_credits"
  | "other";

export type ExtraVideo = {
  id: string;
  site: string | null;
  key: string | null;
  url: string | null;
  type: string | null;     // raw TMDB type
  kind: ExtraVideoKind;    // normalized bucket
  name: string | null;
  official: boolean | null;
  language: string | null; // iso_639_1
  region: string | null;   // iso_3166_1
  publishedAt: string | null;
};

export type CachedShow = {
  tmdbShowId: number;
  title?: string;
  overview?: string;
  genres?: string[];
  posterUrl?: string | null;
  backdropUrl?: string | null;
  logoUrl?: string | null;              // cached logo URL
  firstAirDate?: string | null;
  extraVideos?: ExtraVideo[] | null;    // NEW: cached extra videos
  updatedAt: FirebaseFirestore.Timestamp;
};

export async function getShowFromCache(
  tmdbShowId: number
): Promise<CachedShow | null> {
  const ref = db.doc(`shows/${tmdbShowId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as CachedShow;
  // ensure id is present
  return { ...data, tmdbShowId, updatedAt: data.updatedAt };
}

// Helper to pick the best logo from TMDB details (if images are present)
function pickBestLogoFromDetails(details: any): string | null {
  const logos: any[] | undefined = details?.images?.logos;
  if (!Array.isArray(logos) || logos.length === 0) return null;

  // Sort by vote_count as a crude quality proxy
  const sorted = [...logos].sort(
    (a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0)
  );

  const preferredLangs: (string | null)[] = [
    details?.original_language ?? null,
    "en",
  ];

  for (const lang of preferredLangs) {
    if (!lang) continue;
    const hit = sorted.find(
      (l) => l.iso_639_1 === lang && l.file_path
    );
    if (hit?.file_path) {
      // Reuse backdropUrl helper to build a full TMDB image URL
      return backdropUrl(hit.file_path, "original");
    }
  }

  const first = sorted.find((l) => l.file_path);
  return first?.file_path ? backdropUrl(first.file_path, "original") : null;
}

// Normalize TMDB videos into ExtraVideo[]
function normalizeVideoKind(rawType: string | null | undefined): ExtraVideoKind {
  const t = (rawType || "").toLowerCase();
  if (t === "trailer") return "trailer";
  if (t === "teaser") return "teaser";
  if (t === "clip") return "clip";
  if (t === "behind the scenes" || t === "behind-the-scenes")
    return "behind_the_scenes";
  if (t === "featurette") return "featurette";
  if (t === "bloopers") return "bloopers";
  if (t === "opening credits") return "opening_credits";
  return "other";
}

function buildVideoUrl(site: string | null | undefined, key: string | null | undefined): string | null {
  if (!site || !key) return null;
  if (site === "YouTube") return `https://www.youtube.com/watch?v=${key}`;
  if (site === "Vimeo") return `https://vimeo.com/${key}`;
  return null;
}

function extractExtraVideos(details: any): ExtraVideo[] {
  const raw = details?.videos?.results;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw.map((v: any): ExtraVideo => {
    const id = String(v.id ?? "");
    const site = (v.site as string | undefined) ?? null;
    const key = (v.key as string | undefined) ?? null;
    const type = (v.type as string | undefined) ?? null;
    const name = (v.name as string | undefined) ?? null;
    const official =
      typeof v.official === "boolean" ? v.official : null;
    const language = (v.iso_639_1 as string | undefined) ?? null;
    const region = (v.iso_3166_1 as string | undefined) ?? null;
    const publishedAt = (v.published_at as string | undefined) ?? null;

    return {
      id,
      site,
      key,
      url: buildVideoUrl(site, key),
      type,
      kind: normalizeVideoKind(type),
      name,
      official,
      language,
      region,
      publishedAt,
    };
  });
}

export async function getShowFromCacheOrTMDB(
  tmdbShowId: number
): Promise<CachedShow | null> {
  const cached = await getShowFromCache(tmdbShowId);
  if (cached) {
    return cached;
  }

  // IMPORTANT: tvDetails should be implemented to call TMDB /tv/{id}
  // with append_to_response including at least "images" (for logos) and "videos" (for extras).
  const details = await tvDetails(tmdbShowId);
  if (!details) {
    return null;
  }

  const logoUrl = pickBestLogoFromDetails(details); // logo from images
  const extraVideos = extractExtraVideos(details);  // extras from videos

  const showData: Omit<CachedShow, "updatedAt"> = {
    tmdbShowId: details.id,
    title: details.name,
    overview: details.overview,
    genres: (details.genres || []).map((g: any) => g.name),
    posterUrl: posterUrl(details.poster_path, "w500"),
    backdropUrl: backdropUrl(details.backdrop_path, "original"),
    logoUrl,                                          // cache the logo
    firstAirDate: details.first_air_date,
    extraVideos: extraVideos.length ? extraVideos : null, // cache extra videos if any
  };

  const newDoc: CachedShow = {
    ...showData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
  };

  await db.doc(`shows/${tmdbShowId}`).set(newDoc);

  return newDoc;
}
