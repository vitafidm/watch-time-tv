"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanTitleForSearch = cleanTitleForSearch;
exports.pickYouTubeTrailer = pickYouTubeTrailer;
const RELEASE_TAGS = [
    '2160p', '1080p', '720p', '480p', '4k',
    'uhd', 'hdr', 'hdr10', 'dolby', 'vision', 'dv',
    'webrip', 'web-dl', 'webdl', 'bluray', 'bdrip', 'brrip', 'remux', 'dvdrip',
    'x264', 'x265', 'h264', 'h265', 'hevc', 'av1',
    'aac', 'dts', 'truehd', 'atmos',
    'yify', 'rarbg', 'evo', 'fgt', 'amzn', 'nf', 'hmax', 'crf'
];
// A single regex for all release tags, case-insensitive
const RELEASE_TAG_REGEX = new RegExp(`\\b(${RELEASE_TAGS.join('|')})\\b`, 'i');
/**
 * Cleans a file-based title, extracts the year, and prepares it for searching.
 * @param input The raw title, likely from a filename.
 * @returns An object with a clean title and an optional year.
 */
function cleanTitleForSearch(input) {
    let title = input.replace(/\.[^.]+$/, ''); // Drop extension
    title = title.replace(/[._]+/g, ' '); // Dots/underscores to space
    // Extract year
    let year = null;
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
        title = title.replace(yearMatch[0], ''); // Remove year from title
    }
    // Remove release tags
    title = title.replace(RELEASE_TAG_REGEX, '');
    // Remove trailing group suffixes, like "-FGT"
    title = title.replace(/\s*-\s*[A-Za-z0-9_]+$/, '');
    // Collapse whitespace and trim
    title = title.replace(/\s+/g, ' ').trim();
    return { title, year };
}
/**
 * Picks the best YouTube trailer from a TMDB videos array.
 * @param videos The `results` array from a TMDB video response.
 * @returns The full YouTube watch URL or null.
 */
function pickYouTubeTrailer(videos) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return null;
    }
    const trailers = videos.filter(v => v.site === 'YouTube' && v.type === 'Trailer');
    if (trailers.length === 0) {
        return null;
    }
    // Prefer official trailers, but fall back to the first one available
    const officialTrailer = trailers.find(t => t.official === true);
    const chosenTrailer = officialTrailer || trailers[0];
    return `https://www.youtube.com/watch?v=${chosenTrailer.key}`;
}
//# sourceMappingURL=titleHelpers.js.map