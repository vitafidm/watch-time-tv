// functions/src/flows/tmdb-enrich-episodes.ts

import * as admin from "firebase-admin";
import fetch from "node-fetch";
import { z } from "zod";

const db = admin.firestore();
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";

const EpisodeEnrichBodySchema = z.object({
  items: z.array(z.object({
    mediaId: z.string().min(1),
    showId: z.number().int().positive(), // tmdbShowId for parent show
    season: z.number().int().nonnegative(),
    episode: z.number().int().nonnegative(),
  })).min(1).max(50),
});

type EpisodeEnrichBody = z.infer<typeof EpisodeEnrichBodySchema>;

function pickBestImage(path?: string | null): string | null {
  if (!path) return null;
  return `${IMG_BASE}${path}`;
}

async function tmdbEpisodeDetails(apiKey: string, showId: number, season: number, episode: number) {
  const url = new URL(`${TMDB_BASE}/tv/${showId}/season/${season}/episode/${episode}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("append_to_response", "credits");
  const r = await fetch(url.toString(), { method: "GET" });
  if (!r.ok) return null;
  return r.json() as any;
}

export async function tmdbEnrichEpisodes(uid: string, rawBody: unknown) {
  const parsed = EpisodeEnrichBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const e = new Error(JSON.stringify(parsed.error.issues));
    (e as any).code = "invalid-argument";
    throw e;
  }
  if (!process.env.TMDB_API_KEY) {
    const e = new Error("TMDB_API_KEY not set");
    (e as any).code = "failed-precondition";
    throw e;
  }
  const apiKey = process.env.TMDB_API_KEY!;
  const { items } = parsed.data as EpisodeEnrichBody;

  const results: Array<{ mediaId: string; status: "enriched"|"not_found"|"error"; message?: string }> = [];

  for (const it of items) {
    const mediaRef = db.doc(`users/${uid}/media/${it.mediaId}`);
    const mediaSnap = await mediaRef.get();
    if (!mediaSnap.exists) {
      results.push({ mediaId: it.mediaId, status: "error", message: "episode not found" });
      continue;
    }
    const media = mediaSnap.data() || {};

    try {
      const details = await tmdbEpisodeDetails(apiKey, it.showId, it.season, it.episode);
      if (!details) {
        results.push({ mediaId: it.mediaId, status: "not_found" });
        continue;
      }

      const payload = {
        title: details.name || media.title || null,
        overview: details.overview || media.overview || null,
        stillUrl: pickBestImage(details.still_path) ?? media.stillUrl ?? null,
        airDate: details.air_date || media.airDate || null,
        season: it.season,
        episode: it.episode,
        tmdbShowId: it.showId,
        tmdbEpisodeId: details.id,
        cast: (details.credits?.cast || []).slice(0, 10).map((c: any) => ({
          name: c.name,
          character: c.character,
          profileUrl: pickBestImage(c.profile_path),
        })),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await mediaRef.set(payload, { merge: true });
      results.push({ mediaId: it.mediaId, status: "enriched" });
    } catch (err: any) {
      results.push({ mediaId: it.mediaId, status: "error", message: err?.message || "TMDB error" });
    }
  }

  return { results };
}
