// functions/src/tmdbClient.ts
import * as functions from "firebase-functions";
import fetch, { Response } from "node-fetch";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE_URL = "https://image.tmdb.org/t/p/";

// Small helper to pause
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getApiKey(): string {
  // Prefer Functions config (production), fall back to env (local/emulator)
  try {
    const fromConfig = (functions.config() as any)?.tmdb?.key as string | undefined;
    if (fromConfig) return fromConfig;
  } catch {
    // accessing functions.config() can throw in some local contexts — ignore
  }
  const fromEnv = process.env.TMDB_API_KEY;
  if (fromEnv) return fromEnv;

  throw new Error(
    'TMDB API key not found. Set with `firebase functions:config:set tmdb.key="YOUR_KEY"` ' +
      "or set TMDB_API_KEY in your environment."
  );
}

/**
 * Core fetcher with lightweight retry/backoff for rate limits and transient failures.
 */
export async function tmdbFetch(
  path: string,
  params: Record<string, string> = {}
): Promise<any | null> {
  const apiKey = getApiKey();
  const url = new URL(`${TMDB_BASE_URL}/${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "en-US");

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  // Gentle pacing for normal requests
  await sleep(150);

  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    let res: Response | null = null;

    try {
      res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          // Helps TMDB support know who you are if needed; optional:
          "User-Agent": "watchtime-functions/1.0",
        },
      });

      // Successful
      if (res.ok) {
        return await res.json();
      }

      // Retry on 429 / 5xx
      const status = res.status;
      const text = await res.text().catch(() => "");
      const retryAfter = Number(res.headers.get("retry-after")) || 0;

      if (status === 429 || (status >= 500 && status < 600)) {
        const backoff =
          retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2000 * attempt, 6000); // simple backoff cap at 6s
        functions.logger.warn("TMDB transient error; backing off", {
          status,
          attempt,
          backoffMs: backoff,
          url: url.toString(),
          body: text?.slice(0, 500),
        });
        await sleep(backoff);
        continue;
      }

      // Non-retryable error
      functions.logger.error("TMDB API error (non-retryable)", {
        status,
        url: url.toString(),
        body: text?.slice(0, 1000),
      });
      return null;
    } catch (err: any) {
      // Network/parsing error; retry a couple times
      functions.logger.warn("TMDB fetch threw; retrying if attempts remain", {
        attempt,
        error: err?.message,
        url: url.toString(),
      });
      await sleep(Math.min(2000 * attempt, 6000));
      continue;
    }
  }

  // Exhausted attempts
  functions.logger.error("TMDB fetch failed after retries", { url: url.toString() });
  return null;
}

// ---- Convenience wrappers ----

export async function searchMovie(
  title: string,
  year?: number | null,
  page: number = 1
): Promise<any | null> {
  const params: Record<string, string> = {
    query: title,
    include_adult: "false",
    page: String(page),
  };
  if (year) params.year = String(year);
  return tmdbFetch("search/movie", params);
}

export async function searchTV(
  title: string,
  year?: number | null,
  page: number = 1
): Promise<any | null> {
  const params: Record<string, string> = {
    query: title,
    include_adult: "false",
    page: String(page),
  };
  if (year) params.first_air_date_year = String(year);
  return tmdbFetch("search/tv", params);
}

export async function movieDetails(id: number): Promise<any | null> {
  // includes videos/credits/images for richer Fix Match writes
  return tmdbFetch(`movie/${id}`, { append_to_response: "videos,credits,images" });
}

export async function tvDetails(id: number): Promise<any | null> {
  // includes aggregate_credits/videos/images to align with Fix Match & enrichment parity
  return tmdbFetch(`tv/${id}`, {
    append_to_response: "videos,aggregate_credits,images",
  });
}

/**
 * 🔹 Per-episode details for a TV show.
 * Returns TMDB's raw payload with fields like name, overview, still_path, etc.
 */
export async function tvEpisodeDetails(
  tvId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<any | null> {
  return tmdbFetch(
    `tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`
  );
}

// ---- Image helpers ----

export function posterUrl(
  path?: string,
  size: "w185" | "w500" | "original" = "w500"
): string | null {
  return path ? `${IMG_BASE_URL}${size}${path}` : null;
}

export function backdropUrl(
  path?: string,
  size: "w780" | "original" = "w780"
): string | null {
  return path ? `${IMG_BASE_URL}${size}${path}` : null;
}
