"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEpisodeFromName = parseEpisodeFromName;
/**
 * A list of regular expressions to find season and episode numbers in a filename.
 * They are ordered by precedence. The first one to match wins.
 * Each regex must have two capturing groups: one for season, one for episode.
 */
const EPISODE_PATTERNS = [
    /S(\d{1,2})E(\d{1,2})/i, // S01E02
    /(\d{1,2})x(\d{1,2})/i, // 1x02
    /E(\d{1,2})S(\d{1,2})/i, // E02S01 (swapped)
    /- s(\d{2})e(\d{2})/i, // - s02e23
    /season (\d{1,2}) episode (\d{1,2})/i, // season 1 episode 2
];
/**
 * Extracts season and episode numbers from a filename string.
 *
 * @param name - The filename to parse.
 * @returns An object with `season` and `episodeNumber`, which may be null.
 */
function parseEpisodeFromName(name) {
    for (const pattern of EPISODE_PATTERNS) {
        const match = name.match(pattern);
        if (match) {
            // Standard S/E pattern
            if (pattern.source.includes('S') && pattern.source.includes('E')) {
                const sIndex = pattern.source.indexOf('S');
                const eIndex = pattern.source.indexOf('E');
                if (sIndex < eIndex) {
                    return { season: parseInt(match[1], 10), episodeNumber: parseInt(match[2], 10) };
                }
                else {
                    return { season: parseInt(match[2], 10), episodeNumber: parseInt(match[1], 10) };
                }
            }
            // For 1x02 pattern
            if (pattern.source.includes('x')) {
                return { season: parseInt(match[1], 10), episodeNumber: parseInt(match[2], 10) };
            }
        }
    }
    return { season: null, episodeNumber: null };
}
