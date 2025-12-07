import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import * as crypto from "crypto";
import fetch from "node-fetch";
import { z } from "zod";
import { pickYouTubeTrailer } from "../titleHelpers";

const db = admin.firestore();
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";

const EnrichBodySchema = z.object({
  items: z
    .array(
      z.object({
        mediaId: z.string().min(1),
        type: z.enum(["movie", "episode"]),
        title: z.string().min(1),
        year: z.number().int().optional(),
      })
    )
    .min(1)
    .max(50),
});

type EnrichBody = z.infer<typeof EnrichBodySchema>;

// ---------- Extra videos shape ----------
type ExtraVideoKind =
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
  type: string | null;     // raw TMDB "Trailer", "Clip", ...
  kind: ExtraVideoKind;    // normalized bucket
  name: string | null;
  official: boolean | null;
  language: string | null; // iso_639_1
  region: string | null;   // iso_3166_1
  publishedAt: string | null;
};

type CacheDoc = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  overview?: string;
  genres?: string[];
  releaseDate?: string | null;
  firstAirDate?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  logoPath?: string | null;            // path to logo image in TMDB
  extraVideos?: ExtraVideo[] | null;   // ✅ cached extras
  voteAverage?: number | null;
  language?: string | null;
  cast?: any[] | null;
  videoLink?: string | null;
  // Firestore Timestamp when read OR server timestamp when written
  cachedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type SearchHit = { id: number; tmdbType: "movie" | "tv" };

function cacheKey(type: "movie" | "episode", title: string, year?: number) {
  const base = `${type === "episode" ? "tv" : "movie"}:${title
    .trim()
    .toLowerCase()}:${year ?? ""}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 40);
}

function pickBestImage(path?: string | null): string | null {
  if (!path) return null;
  return `${IMG_BASE}${path}`;
}

// ---------- Logo helpers ----------

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

  const preferredLangs = [
    details?.original_language || null,
    "en",
  ].filter(Boolean) as string[];

  for (const lang of preferredLangs) {
    const hit = sorted.find((l) => l.iso_639_1 === lang && l.file_path);
    if (hit?.file_path) return hit.file_path;
  }

  const first = sorted.find((l) => !!l.file_path);
  return first?.file_path ?? null;
}

// ---------- Extra videos helpers ----------

function normalizeVideoKind(rawType: string | null | undefined): ExtraVideoKind {
  const t = (rawType || "").toLowerCase();
  if (t === "trailer") return "trailer";
  if (t === "teaser") return "teaser";
  if (t === "clip") return "clip";
  if (t === "behind the scenes" || t === "behind-the-scenes") return "behind_the_scenes";
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

// ---------- TMDB calls ----------

async function tmdbSearch(
  apiKey: string,
  type: "movie" | "episode",
  title: string,
  year?: number
): Promise<SearchHit | null> {
  const isTV = type === "episode";
  const endpoint = isTV ? "search/tv" : "search/movie";
  const url = new URL(`${TMDB_BASE}/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  if (year)
    url.searchParams.set(
      isTV ? "first_air_date_year" : "year",
      String(year)
    );
  url.searchParams.set("include_adult", "false");
  const r = await fetch(url.toString(), { method: "GET" });
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  const first = (j?.results || [])[0];
  if (!first) return null;
  return { id: first.id, tmdbType: isTV ? "tv" : "movie" };
}

async function tmdbDetails(
  apiKey: string,
  tmdbType: "movie" | "tv",
  id: number
) {
  const url = new URL(`${TMDB_BASE}/${tmdbType}/${id}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("append_to_response", "credits,videos,images");
  const r = await fetch(url.toString(), { method: "GET" });
  if (!r.ok) return null;
  return (await r.json()) as any;
}

// ---------- Main flow ----------

export async function tmdbEnrichFlow(uid: string, rawBody: unknown) {
  // Validate input
  const parsed = EnrichBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const e = new Error(JSON.stringify(parsed.error.issues));
    (e as any).code = "invalid-argument";
    throw e;
  }

  // ---- API key loading: functions config first, env fallback ----
  const cfgKey = (functions.config?.().tmdb?.api_key) as string | undefined;
  const envKey = process.env.TMDB_API_KEY as string | undefined;
  const apiKey = cfgKey || envKey;
  if (!apiKey) {
    functions.logger.error("TMDB API key missing", {
      hasConfig: !!cfgKey,
      hasEnv: !!envKey,
    });
    const e = new Error("TMDB_API_KEY not set");
    (e as any).code = "failed-precondition";
    throw e;
  }

  const { items } = parsed.data as EnrichBody;

  // ---- Per-user rate limit: 1 call / 10s ----
  const rateRef = db.doc(`users/${uid}/integrations_meta/tmdbRateLimit`);
  const rateSnap = await rateRef.get();
  const now = Date.now();
  const cooldownMs = 10_000;

  if (rateSnap.exists) {
    const until = rateSnap.get("rateLimitedUntil")?.toDate?.() as
      | Date
      | undefined;
    if (until && until.getTime() > now) {
      const e = new Error("Please wait before enriching again.");
      (e as any).code = "resource-exhausted";
      throw e;
    }
  }

  await rateRef.set(
    {
      lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
      rateLimitedUntil: admin.firestore.Timestamp.fromDate(
        new Date(now + cooldownMs)
      ),
    },
    { merge: true }
  );

  const results: Array<{
    mediaId: string;
    status: "enriched" | "skipped" | "not_found" | "error";
    message?: string;
  }> = [];

  for (const it of items) {
    const mediaRef = db.doc(`users/${uid}/media/${it.mediaId}`);
    const mediaSnap = await mediaRef.get();
    if (!mediaSnap.exists) {
      results.push({
        mediaId: it.mediaId,
        status: "error",
        message: "media not found",
      });
      continue;
    }
    const media = mediaSnap.data() || {};

    // NOTE: We still keep the "already enriched" short-circuit.
    // If you later want to backfill logos/extras for existing items,
    // we can relax this condition.
    if (media.tmdbId && (media.posterUrl || media.backdropUrl)) {
      results.push({ mediaId: it.mediaId, status: "skipped" });
      continue;
    }

    const key = cacheKey(it.type, it.title, it.year);
    const cacheRef = db
      .collection(`users/${uid}/integrations_cache_tmdb`)
      .doc(key);

    let cached: CacheDoc | null = await cacheRef
      .get()
      .then((s) => (s.exists ? (s.data() as CacheDoc) : null));

    // 30-day cache TTL
    const fresh =
      !!(cached as any)?.cachedAt &&
      typeof (cached as any).cachedAt?.toDate === "function" &&
      Date.now() -
        (cached as any).cachedAt.toDate().getTime() <
        30 * 24 * 3600 * 1000;

    try {
      if (!cached || !fresh) {
        // Search by title (episodes => TV)
        const search = await tmdbSearch(
          apiKey,
          it.type,
          it.title,
          it.year
        );
        if (!search) {
          results.push({ mediaId: it.mediaId, status: "not_found" });
          continue;
        }

        const details = await tmdbDetails(
          apiKey,
          search.tmdbType,
          search.id
        );
        if (!details) {
          results.push({ mediaId: it.mediaId, status: "not_found" });
          continue;
        }

        const genres = (details.genres || [])
          .map((g: any) => g.name)
          .filter(Boolean);
        const overview = details.overview || null;
        const releaseDate = details.release_date || null;
        const firstAirDate = details.first_air_date || null;
        const voteAverage =
          typeof details.vote_average === "number"
            ? details.vote_average
            : null;
        const language = details.original_language || null;

        const cast = (details.credits?.cast || [])
          .slice(0, 10)
          .map((c: any) => ({
            name: c.name,
            character: c.character,
            profileUrl: pickBestImage(c.profile_path),
          }));
        const videoLink = pickYouTubeTrailer(details.videos?.results);

        // ✅ NEW: compute logoPath & extraVideos from TMDB details
        const logoPath = pickBestLogoFromDetails(details);
        const extraVideos = extractExtraVideos(details);
        const extraVideosOrNull = extraVideos.length ? extraVideos : null;

        const toWrite: CacheDoc = {
          tmdbId: details.id,
          tmdbType: search.tmdbType, // "movie" | "tv"
          overview,
          genres,
          releaseDate,
          firstAirDate,
          posterPath: details.poster_path ?? null,
          backdropPath: details.backdrop_path ?? null,
          logoPath: logoPath ?? null,
          extraVideos: extraVideosOrNull,
          voteAverage,
          language,
          cast,
          videoLink,
          cachedAt: admin.firestore.FieldValue
            .serverTimestamp() as FirebaseFirestore.FieldValue,
        };

        await cacheRef.set(toWrite, { merge: true });
        cached = toWrite;
      }

      if (!cached) {
        results.push({
          mediaId: it.mediaId,
          status: "error",
          message: "cache unavailable",
        });
        continue;
      }

      // Merge write onto media doc (do not touch addedAt)
      const payload: Record<string, any> = {
        tmdbId: cached.tmdbId,
        tmdbType: cached.tmdbType, // "movie" or "tv"

        overview: cached.overview ?? media.overview ?? null,
        genres: cached.genres ?? media.genres ?? [],
        cast: cached.cast ?? media.cast ?? [],
        videoLink: cached.videoLink ?? media.videoLink ?? null,
        releaseDate: cached.releaseDate ?? media.releaseDate ?? null,
        firstAirDate:
          cached.firstAirDate ?? media.firstAirDate ?? null,

        posterUrl:
          pickBestImage(cached.posterPath) ??
          media.posterUrl ??
          null,
        backdropUrl:
          pickBestImage(cached.backdropPath) ??
          media.backdropUrl ??
          null,

        // ✅ NEW: write logoUrl from cached.logoPath (respect existing value if present)
        logoUrl:
          pickBestImage(cached.logoPath) ??
          media.logoUrl ??
          null,

        // ✅ NEW: write extraVideos (fallback to existing or null)
        extraVideos:
          cached.extraVideos ??
          media.extraVideos ??
          null,

        voteAverage: cached.voteAverage ?? media.voteAverage ?? null,
        language: cached.language ?? media.language ?? null,

        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await mediaRef.set(payload, { merge: true });
      results.push({ mediaId: it.mediaId, status: "enriched" });
    } catch (err: any) {
      results.push({
        mediaId: it.mediaId,
        status: "error",
        message: err?.message || "TMDB error",
      });
    }
  }

  return { results };
}

// Optional periodic sweep (unchanged)
export async function tmdbBackfillSweep() {
  const snap = await db
    .collectionGroup("media")
    .where("tmdbId", "==", null)
    .limit(200)
    .get();

  const byOwner: Record<
    string,
    Array<{
      mediaId: string;
      type: "movie" | "episode";
      title: string;
      year?: number;
    }>
  > = {};

  for (const d of snap.docs) {
    const path = d.ref.path; // users/{uid}/media/{mediaId}
    const segs = path.split("/");
    const uid = segs[1];
    const m = d.data() as any;
    if (!uid || !m) continue;
    const type = (m.type === "episode"
      ? "episode"
      : "movie") as "movie" | "episode";
    const title = m.normalizedTitle || m.title || m.filename || "unknown";
    const year = m.year;
    (byOwner[uid] ||= []).push({ mediaId: d.id, type, title, year });
  }

  for (const [uid, items] of Object.entries(byOwner)) {
    const chunk = items.slice(0, 50);
    try {
      await tmdbEnrichFlow(uid, { items: chunk });
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e: any) {
      console.error(
        `Skipping backfill for user ${uid} due to error: ${e.message}`
      );
    }
  }

  return { ownersProcessed: Object.keys(byOwner).length };
}
