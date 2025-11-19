// functions/src/tmdbEpisodeDetailsBatch.ts
import * as functions from "firebase-functions";
import { tmdbFetch, backdropUrl } from "./tmdbClient";

type EpisodeInput = {
  season: number;
  episode: number;
};

type EpisodeMeta = {
  name: string | null;
  overview: string | null;
  stillUrl: string | null;
  airDate: string | null;
  runtime: number | null;
};

function episodeKey(season: number, episode: number): string {
  return `S${season}E${episode}`;
}

/**
 * HTTP function to batch-fetch TMDB episode details for a given TV show.
 *
 * Request body (flexible, supports both shapes):
 *
 *  {
 *    tmdbShowId: number | string,   // preferred
 *    // or: showId / tvId
 *    episodes?: [
 *      { season: number | string, episode: number | string },
 *      ...
 *    ],
 *    // OR (legacy shape):
 *    items?: [
 *      { season: number | string, episode: number | string, showId?: number | string },
 *      ...
 *    ]
 *  }
 *
 * Response:
 *  {
 *    "S1E1": { name, overview, stillUrl, airDate, runtime },
 *    "S1E2": { ... },
 *    ...
 *  }
 *
 * On any validation/parsing issue, it returns `{}` with status 200
 * so the UI never sees a 400 / Bad Request.
 */
export const tmdbEpisodeDetailsBatch = functions.https.onRequest(
  async (req, res): Promise<void> => {
    // --- Manual CORS, no external middleware ---
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");

    // Preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      if (req.method !== "POST") {
        // Be gentle: don't 400/405, just return empty payload
        functions.logger.info("tmdbEpisodeDetailsBatch: non-POST method", {
          method: req.method,
        });
        res.status(200).json({});
        return;
      }

      const rawBody = (req.body ?? {}) as {
        tmdbShowId?: number | string;
        showId?: number | string;
        tvId?: number | string;
        episodes?: Array<{
          season?: number | string;
          episode?: number | string;
        }>;
        items?: Array<{
          season?: number | string;
          episode?: number | string;
          showId?: number | string;
        }>;
      };

      functions.logger.info("tmdbEpisodeDetailsBatch: incoming body", {
        method: req.method,
        hasBody: !!req.body,
        keys: Object.keys(rawBody || {}),
      });

      // --- Normalize TV show id ---
      const tvIdRaw =
        rawBody.tmdbShowId ??
        rawBody.showId ??
        rawBody.tvId;

      const tvId = Number(tvIdRaw);

      if (!Number.isFinite(tvId) || tvId <= 0) {
        functions.logger.warn(
          "tmdbEpisodeDetailsBatch: invalid or missing tv/tmdbShowId",
          {
            tmdbShowId: rawBody.tmdbShowId,
            showId: rawBody.showId,
            tvId: rawBody.tvId,
          }
        );
        res.status(200).json({});
        return;
      }

      // --- Normalize episodes array (support both `episodes` and `items`) ---
      let episodesRaw: any[] = [];
      if (Array.isArray(rawBody.episodes)) {
        episodesRaw = rawBody.episodes;
      } else if (Array.isArray(rawBody.items)) {
        episodesRaw = rawBody.items;
      }

      const normalized: EpisodeInput[] = episodesRaw
        .map((e: any) => ({
          season: Number(
            e.season ??
              e.seasonNumber ??
              e.s
          ),
          episode: Number(
            e.episode ??
              e.episodeNumber ??
              e.e
          ),
        }))
        .filter(
          (e) =>
            Number.isFinite(e.season) &&
            Number.isFinite(e.episode) &&
            e.season > 0 &&
            e.episode > 0
        );

      if (normalized.length === 0) {
        functions.logger.info(
          "tmdbEpisodeDetailsBatch: no valid episodes in request",
          {
            episodesLength: Array.isArray(rawBody.episodes)
              ? rawBody.episodes.length
              : 0,
            itemsLength: Array.isArray(rawBody.items)
              ? rawBody.items.length
              : 0,
          }
        );
        res.status(200).json({});
        return;
      }

      // De-dupe (S/E pairs)
      const seen = new Set<string>();
      const uniqueEpisodes: EpisodeInput[] = [];
      for (const ep of normalized) {
        const key = episodeKey(ep.season, ep.episode);
        if (!seen.has(key)) {
          seen.add(key);
          uniqueEpisodes.push(ep);
        }
      }

      const result: Record<string, EpisodeMeta> = {};

      // --- Fetch each episode from TMDB in parallel ---
      await Promise.all(
        uniqueEpisodes.map(async (ep) => {
          try {
            const path = `tv/${tvId}/season/${ep.season}/episode/${ep.episode}`;
            const raw = await tmdbFetch(path, {
              append_to_response: "images",
            });

            if (!raw) return;

            const name: string | null =
              (raw.name as string | undefined)?.trim() ||
              (raw.episode_number != null
                ? `Episode ${raw.episode_number}`
                : null);

            const overview: string | null =
              (raw.overview as string | undefined)?.trim() || null;

            // Try primary still, then first in images.stills
            const stillPath: string | undefined =
              (raw.still_path as string | undefined) ||
              (raw.images &&
                Array.isArray(raw.images.stills) &&
                raw.images.stills[0]?.file_path) ||
              undefined;

            const stillUrl = stillPath
              ? backdropUrl(stillPath, "w780")
              : null;

            const airDate: string | null =
              (raw.air_date as string | undefined)?.trim() || null;

            const runtime: number | null =
              typeof raw.runtime === "number" ? raw.runtime : null;

            const key = episodeKey(ep.season, ep.episode);
            result[key] = {
              name,
              overview,
              stillUrl,
              airDate,
              runtime,
            };
          } catch (err: any) {
            functions.logger.warn(
              "tmdbEpisodeDetailsBatch: episode fetch failed",
              {
                tvId,
                season: ep.season,
                episode: ep.episode,
                error: err?.message,
              }
            );
          }
        })
      );

      res.status(200).json(result);
    } catch (err: any) {
      functions.logger.error(
        "tmdbEpisodeDetailsBatch: unexpected error",
        { error: err?.message }
      );
      // Fail soft so the UI never gets a 400
      res.status(200).json({});
    }
  }
);
