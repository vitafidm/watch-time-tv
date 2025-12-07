import * as functions from "firebase-functions";
import cors from "cors";
import fetch from "node-fetch";
import { posterUrl } from "./tmdbClient"; // keep using your existing helper

const corsHandler = cors({ origin: true });

type KindParam = "movie" | "tv" | "show";
function mapKind(kind: KindParam): "movie" | "tv" {
  return kind === "show" ? "tv" : kind;
}

export default functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    try {
      const { kind, tmdbId, language } = req.body || {};
      const k = mapKind(kind as KindParam);
      const idNum = Number(tmdbId);

      if (!idNum || Number.isNaN(idNum)) {
        functions.logger.error("tmdbMedia: invalid tmdbId", { tmdbId });
        res.status(400).json({ error: "Invalid tmdbId" });
        return;
      }
      if (k !== "movie" && k !== "tv") {
        functions.logger.error("tmdbMedia: invalid kind", { kind });
        res
          .status(400)
          .json({ error: "Invalid kind. Use 'movie' or 'tv' (or 'show')." });
        return;
      }

      const apiKey =
        (functions.config()?.tmdb && functions.config().tmdb.key) ||
        process.env.TMDB_API_KEY;
      if (!apiKey) {
        functions.logger.error("tmdbMedia: missing TMDB API key");
        res.status(500).json({ error: "TMDB API key not configured" });
        return;
      }

      // Build TMDB URL (inline base URL; your tmdbClient didn’t export one)
      const url = new URL(`https://api.themoviedb.org/3/${k}/${idNum}`);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("append_to_response", "images,videos");
      // Accept original + English + optional requested language
      url.searchParams.set(
        "include_image_language",
        ["null", "en", language].filter(Boolean).join(",")
      );
      if (language) url.searchParams.set("language", language);

      functions.logger.info("tmdbMedia: fetching", {
        url: url.toString(),
        kind: k,
        idNum,
      });

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        functions.logger.error("tmdbMedia: TMDB fetch failed", {
          status: resp.status,
          text: text?.slice(0, 400),
        });
        res.status(502).json({ error: `TMDB responded ${resp.status}` });
        return;
      }

      const data: any = await resp.json();

      // Posters
      const posters =
        Array.isArray(data?.images?.posters)
          ? data.images.posters
              .filter((p: any) => p?.file_path)
              .slice(0, 60)
              .map((p: any) => ({ url: posterUrl(p.file_path, "w500") }))
          : [];

      // Backdrops
      const backdrops =
        Array.isArray(data?.images?.backdrops)
          ? data.images.backdrops
              .filter((b: any) => b?.file_path)
              .slice(0, 60)
              .map((b: any) => ({ url: posterUrl(b.file_path, "original") }))
          : [];

      // Logos (new)
      const logos =
        Array.isArray(data?.images?.logos)
          ? data.images.logos
              .filter((l: any) => l?.file_path)
              .slice(0, 60)
              .map((l: any) => ({ url: posterUrl(l.file_path, "original") }))
          : [];

      // Normalize videos (YouTube trailers)
      const videos =
        Array.isArray(data?.videos?.results)
          ? data.videos.results
              .filter((v: any) => v?.site === "YouTube" && v?.key)
              .slice(0, 30)
              .map((v: any) => ({
                key: v.key,
                name: v.name,
                type: v.type,
                thumbnailUrl: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`,
              }))
          : [];

      res.json({ posters, backdrops, videos, logos });
    } catch (err: any) {
      functions.logger.error("tmdbMedia: internal error", {
        message: err?.message,
        stack: err?.stack,
      });
      res.status(500).json({ error: "Internal error in tmdbMedia" });
    }
  });
});
