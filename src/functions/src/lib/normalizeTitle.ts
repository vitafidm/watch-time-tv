// src/lib/normalizeTitle.ts
import path from "path";

/**
 * Clean a movie title from filename/path.
 * - Prefer filename stem; if a year exists, cut everything after the year.
 * - Fall back to parent folder only if it clearly looks like a title folder.
 * - Strip release junk (codecs, resolutions, groups, audio channels, etc.).
 * - Preserve stylized hyphens like "WALL-E".
 * - Episodes always return null (normalizedTitle is movies-only).
 */
export function normalizeTitle(input: {
  filename: string;
  path: string;
  type: "movie" | "episode";
  year?: number | null;
}): string | null {
  if (input.type !== "movie") return null;

  const junkDirPatterns: RegExp[] = [
    /^movies?$/i,
    /^tv$/i,
    /^shows?$/i,
    /^plex\s*library$/i,
    /^library$/i,
    /^small$/i,
    /^samples?$/i,
    /^extras?$/i,
    /^season\s*\d{1,3}$/i,
    /^\d{3,4}p$/i,
  ];

  const looksLikeTitleDir = (s: string) => {
    const trimmed = s.trim();
    if (!trimmed) return false;
    if (junkDirPatterns.some((re) => re.test(trimmed))) return false;
    // Accept things like "Inglourious Basterds (2009)" or a non-generic multi-word phrase
    if (/\(\d{4}\)$/.test(trimmed)) return true;
    return /[A-Za-z].*[A-Za-z]/.test(trimmed) && trimmed.length >= 6 && !/^\d/.test(trimmed);
  };

  const filenameStem = path.basename(input.filename, path.extname(input.filename));
  const parent = path.basename(path.dirname(input.path));

  // If the filename contains a year, cut everything after the first year token.
  const yearCut = (() => {
    const m = filenameStem.match(/(19|20)\d{2}/);
    if (!m) return filenameStem;
    return filenameStem.slice(0, m.index).trim();
  })();

  // Prefer filename (possibly cut at year). Fall back to parent if it clearly looks like a title dir.
  const sourceName = (yearCut && yearCut.length >= 2)
    ? yearCut
    : looksLikeTitleDir(parent) ? parent : filenameStem;

  // 1) Replace separators: dots/underscores -> spaces (keep hyphens for WALL-E etc.).
  let s = sourceName.replace(/[._]+/g, " ");

  // 2) Remove [ ... ] entirely; remove ( ... ) unless it is exactly (YYYY)
  s = s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?!\d{4}\))[^)]*\)/g, " ");

  // 3) Strip release junk tokens (case-insensitive, roughly whole-word)
  const junkTokens = [
    // resolutions
    /\b(2160p|1080p|720p|480p|4k|uhd)\b/gi,
    // codecs / audio formats
    /\b(x264|x265|h\.?264|h\.?265|av1|hevc|aac|ddp(?:5\.1)?|dts(?:-hd)?|truehd)\b/gi,
    // sources
    /\b(bluray|blu-ray|webrip|web[-\s]?dl|hdrip|brrip|dvdrip|remux|hdr)\b/gi,
    // misc scene flags
    /\b(proper|repack|multi|esub|subs?)\b/gi,
    // release groups / trailing "-Group"
    /-\s*[A-Za-z0-9]{2,}$/g,
    // “opus” (will also remove channel numbers below)
    /\bopus\b/gi,
  ];
  for (const re of junkTokens) s = s.replace(re, " ");

  // 4) Explicitly remove audio channel tokens (handle separators): 5.1, 7.1, 7.1.2, 2.0, etc.
  s = s
    .replace(/\b(?:5[._-]?1|7[._-]?1(?:[._-]?2)?|2[._-]?0)\b/gi, " ") // common layouts
    .replace(/\b(?:mono|stereo)\b/gi, " "); // just in case

  // 5) Remove freestanding year tokens (we already used them for cutting)
  s = s
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\(\s*(19|20)\d{2}\s*\)$/g, " ");

  // 6) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  if (!s) return null;

  // 7) Smart title case while preserving acronyms and hyphenated caps like WALL-E
  s = s
    .split(" ")
    .map((w) => {
      if (w === w.toUpperCase() && w.length > 1) return w; // keep acronyms
      if (w.includes("-")) {
        return w
          .split("-")
          .map((seg) =>
            seg === seg.toUpperCase() && seg.length > 1
              ? seg
              : seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
          )
          .join("-");
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");

  // 8) If we somehow ended with a trailing tiny numeric token (e.g., "5" or "1"), drop it.
  s = s.replace(/\s+\d{1,2}$/, "").trim();

  // 9) Final guard: avoid returning generic/junk dir names as titles
  if (junkDirPatterns.some((re) => re.test(s))) return null;

  return s || null;
}

export default normalizeTitle;
