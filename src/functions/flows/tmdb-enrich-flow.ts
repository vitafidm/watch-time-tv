// src/functions/flows/tmdb-enrich-flow.ts
import * as crypto from "crypto";
import { z } from "zod";
import { admin, db } from "../lib/admin";

type MediaKind = "movie" | "tv";           // TMDB kinds
type IngestMediaType = "movie" | "episode"; // What the agent/app sends

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

type CacheDoc = {
  tmdbId: number;
  tmdbType: MediaKind; // "movie" | "tv"
  overview?: string | null;
  genres?: string[] | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  voteAverage?: number | null;
  language?: string | null;
  cachedAt: FirebaseFirestore.Timestamp;
};

function toMediaKind(type: IngestMediaType): MediaKind {
  // episodes map to tv searches/details
  return type === "episode" ? "tv" : "movie";
}

function cacheKey(type: IngestMediaType, title: string, year?: number) {
  const base = `${toMediaKind(type)}:${title.trim().toLowerCase()}:${year ?? ""}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 40);
}

function pickBestImage(path?: string | null): string | null {
  if (!path) return null;
  return `${IMG_BASE}${path}`;
}

async function tmdbSearch(
  apiKey: string,
  type: IngestMediaType,
  title: string,
  year?: number
) {
  const isTV = type === "episode";
  const endpoint = isTV ? "search/tv" : "search/movie";
  const url = new URL(`${TMDB_BASE}/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  if (year) url.searchParams.set(isTV ? "first_air_date_year" : "year", String(year));
  url.searchParams.set("include_adult", "false");

  const r = await fetch(url.toString(), { method: "GET" });
  if (!r.ok) return null;

  const j = (await r.json()) as any;
  const first = (j?.results || [])[0];
  if (!first) return null;

  const tmdbType: MediaKind = isTV ? "tv" : "movie";
  return { id: Number(first.id), tmdbType };
}

async function tmdbDetails(apiKey: string, tmdbType: MediaKind, id: number) {
  const url = new URL(`${TMDB_BASE}/${tmdbType}/${id}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("append_to_response", "credits");
  const r = await fetch(url.toString(), { method: "GET" });
  if (!r.ok) return null;
  return (await r.json()) as any;
}

export async function tmdbEnrichFlow(uid: string, rawBody: unknown) {
  // Validate body
  const parsed = EnrichBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const e = new Error(JSON.stringify(parsed.error.issues));
    (e as any).code = "invalid-argument";
    throw e;
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    const e = new Error("TMDB_API_KEY not set");
    (e as any).code = "failed-precondition";
    throw e;
  }

  const { items } = parsed.data as EnrichBody;

  // Lightweight per-user rate limit (1 call / 10s)
  const rateRef = db.doc(`users/${uid}/integrations_meta/tmdbRateLimit`);
  const rateSnap = await rateRef.get();
  const nowMs = Date.now();
  const cooldownMs = 10_000;

  if (rateSnap.exists) {
    const until = rateSnap.get("rateLimitedUntil")?.toDate?.() as Date | undefined;
    if (until && until.getTime() > nowMs) {
      const e = new Error("Please wait before enriching again.");
      (e as any).code = "resource-exhausted";
      throw e;
    }
  }

  await rateRef.set(
    {
      lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
      rateLimitedUntil: admin.firestore.Timestamp.fromDate(new Date(nowMs + cooldownMs)),
    },
    { merge: true }
  );

  const results: Array<
    { mediaId: string; status: "enriched" | "skipped" | "not_found" | "error"; message?: string }
  > = [];

  for (const it of items) {
    const mediaRef = db.doc(`users/${uid}/media/${it.mediaId}`);
    const mediaSnap = await mediaRef.get();
    if (!mediaSnap.exists) {
      results.push({ mediaId: it.mediaId, status: "error", message: "media not found" });
      continue;
    }
    const media = mediaSnap.data() || {};

    // If already enriched with images, skip
    if (media.tmdbId && (media.posterUrl || media.backdropUrl)) {
      results.push({ mediaId: it.mediaId, status: "skipped" });
      continue;
    }

    const key = cacheKey(it.type, it.title, it.year);
    const cacheRef = db.doc(`users/${uid}/integrations_cache/tmdb/${key}`);
    let cached = await cacheRef.get().then((s) => (s.exists ? (s.data() as CacheDoc) : null));

    // 30-day cache TTL
    const fresh =
      cached?.cachedAt?.toDate?.() &&
      Date.now() - cached.cachedAt.toDate().getTime() < 30 * 24 * 3600 * 1000;

    try {
      if (!cached || !fresh) {
        const search = await tmdbSearch(apiKey, it.type, it.title, it.year);
        if (!search) {
          results.push({ mediaId: it.mediaId, status: "not_found" });
          continue;
        }

        const details = await tmdbDetails(apiKey, search.tmdbType, search.id);
        if (!details) {
          results.push({ mediaId: it.mediaId, status: "not_found" });
          continue;
        }

        const genres = (details.genres || []).map((g: any) => g.name).filter(Boolean);
        const overview = details.overview || null;
        const posterPath = details.poster_path ?? null;
        const backdropPath = details.backdrop_path ?? null;
        const releaseDate = details.release_date ?? null;
        const firstAirDate = details.first_air_date ?? null;
        const voteAverage = typeof details.vote_average === "number" ? details.vote_average : null;
        const language = details.original_language ?? null;

        // Write/refresh cache doc (concrete object; not null)
        cached = {
          tmdbId: Number(details.id),
          tmdbType: search.tmdbType,
          overview,
          genres,
          releaseDate,
          firstAirDate,
          posterPath,
          backdropPath,
          voteAverage,
          language,
          cachedAt: admin.firestore.FieldValue.serverTimestamp() as any,
        };
        await cacheRef.set(cached, { merge: true });
      }

      // Prepare upsert payload for media
      const payload = {
        tmdbId: cached.tmdbId,
        tmdbType: cached.tmdbType,
        overview: cached.overview ?? media.overview ?? null,
        genres: cached.genres ?? media.genres ?? null,
        releaseDate: cached.releaseDate ?? media.releaseDate ?? null,
        firstAirDate: cached.firstAirDate ?? media.firstAirDate ?? null,
        posterUrl: pickBestImage(cached.posterPath) ?? media.posterUrl ?? null,
        backdropUrl: pickBestImage(cached.backdropPath) ?? media.backdropUrl ?? null,
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

// Scheduled sweep for missing metadata
export async function tmdbBackfillSweep() {
  // Find media docs missing tmdbId and group by owner (users/{uid}/media/{mediaId})
  const snap = await db
    .collectionGroup("media")
    .where("tmdbId", "==", null)
    .limit(200)
    .get();

  const byOwner: Record<
    string,
    Array<{ mediaId: string; type: IngestMediaType; title: string; year?: number }>
  > = {};

  for (const d of snap.docs) {
    const path = d.ref.path; // users/{uid}/media/{mediaId}
    const segs = path.split("/");
    const uid = segs[1];
    const m = d.data() as any;
    if (!uid || !m) continue;

    const type: IngestMediaType = m.type === "episode" ? "episode" : "movie";
    const title = m.title || m.filename || "unknown";
    const year = m.year;
    (byOwner[uid] ||= []).push({ mediaId: d.id, type, title, year });
  }

  for (const [uid, items] of Object.entries(byOwner)) {
    const chunk = items.slice(0, 50);
    try {
      await tmdbEnrichFlow(uid, { items: chunk });
      // soft spacing between owners
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e: any) {
      console.error(`Skipping backfill for user ${uid} due to error: ${e.message}`);
    }
  }

  return { ownersProcessed: Object.keys(byOwner).length };
}
