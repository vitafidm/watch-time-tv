
/**
 * A set of common "release junk" tokens to be removed from titles.
 * This list is case-insensitive.
 */
const RELEASE_JUNK = new Set([
  'bluray', 'web-dl', 'webdl', 'webrip', 'hdrip', 'x264', 'x265', 'h264', 'h265',
  'hevc', 'av1', '10bit', '1080p', '2160p', '720p', '4k', 'uhd', 'hdr', 'multi',
  'ddp5.1', 'esub', 'rav1ne', 'av1d', 'mcx',
]);

/**
 * A set of regexes to remove descriptive prefixes.
 */
const PREFIX_JUNK: RegExp[] = [
  /^PRADA presents\s+/i,
  /^Come Together\s*-\s*an H&M Holiday\s*/i,
  /^Short Film\s+/i,
  /^dir\.\s*by\s+.*?\b/i,
  /^an?\s+H&M\s+Holiday\s+Short\s+Film\s+/i,
  /^Wes Anderson\s+/i,
];

/**
 * Cleans and normalizes a movie title from its filename or path components.
 *
 * @param input - The media item's file information.
 * @returns A cleaned title string, or null if a confident title cannot be derived.
 */
export function normalizeTitle(input: {
  filename: string;
  path: string;
  type: 'movie' | 'episode';
  year?: number | null;
}): string | null {
  if (input.type !== 'movie') {
    return null;
  }

  // 1. Start with filename, remove extension
  let title = input.filename.replace(/\.[^/.]+$/, '');

  // 2. Replace common separators
  title = title.replace(/[._]/g, ' ');

  // 3. Remove parenthesized/bracketed scene tags, but preserve year
  title = title.replace(/(\[[^\]]+\])/g, (match) => {
    // Check if the match contains a year-like number, if so, don't remove it.
    return /\b(19|20)\d{2}\b/.test(match) ? match : '';
  });
  
  // 4. Remove year from title for cleaner processing, will be re-added if needed.
  title = title.replace(/\(\s*(19|20)\d{2}\s*\)/g, '').replace(/\b(19|20)\d{2}\b/g, '');
  
  // 5. Remove junk prefixes
  for (const re of PREFIX_JUNK) {
    title = title.replace(re, '');
  }

  // 6. Split into words and remove release junk tokens
  let words = title.split(/\s+/);
  words = words.filter(word => !RELEASE_JUNK.has(word.toLowerCase()));
  title = words.join(' ');
  
  // 7. Normalize spacing and trim
  title = title.replace(/\s+/g, ' ').trim();
  
  // Return null if the title is empty after cleaning
  if (!title) {
    return null;
  }

  return title;
}
