
export type EpisodeLike = {
  id: string;
  title?: string;
  filename?: string;
  path?: string;
};

/**
 * Converts an ALL_CAPS string to Title Case.
 * @param {string} name The string to convert.
 * @returns {string} The converted string or the original if not all caps.
 */
export function toTitleCaseIfAllCaps(name: string): string {
    if (!name || name.length < 3) return name;
    
    const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
    if (letterCount === 0) return name;

    const upperCount = (name.match(/[A-Z]/g) || []).length;

    if (upperCount / letterCount >= 0.8) { // 80% or more letters are uppercase
        return name.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    }
    return name;
}


/**
 * Derives a clean show name from an episode's file metadata.
 * It prioritizes the parent folder name and falls back to parsing the filename.
 * @param {EpisodeLike} ep The episode metadata.
 * @returns {string} The derived show name.
 */
export function deriveShowName(ep: EpisodeLike): string {
  let baseName = '';

  // Priority 1: Use parent folder name from the path.
  if (ep.path) {
    const segments = ep.path.split('/').filter(Boolean);
    if (segments.length > 1) {
      baseName = segments[segments.length - 2];
    }
  }

  // Priority 2: Fallback to filename if no suitable folder was found.
  if (!baseName) {
    const baseRaw = ep.filename ?? ep.title ?? '';
    let normalizedFile = baseRaw.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim();
    
    const patterns = [
        /\bS\d{1,2}E\d{1,2}\b/i,
        /\b\d{1,2}x\d{1,2}\b/i,
        /\bSeason\s*\d+\b/i,
    ];
    let cutIdx = -1;
    for (const re of patterns) {
        const m = re.exec(normalizedFile);
        if (m) {
            cutIdx = (cutIdx === -1) ? m.index : Math.min(cutIdx, m.index);
        }
    }
    baseName = cutIdx > -1 ? normalizedFile.slice(0, cutIdx) : normalizedFile;
  }
  
  // Cleanup passes
  let cleanedName = baseName.trim();
  
  // Remove common junk suffixes
  const junkSuffixes = [
      /( -\s*(Season|Series)\s*\d+.*)$/i,
      /( -\s*Book\s*\d+.*)$/i,
      /( -\s*Disc\s*[^-]+)$/i,
  ];
  for (const re of junkSuffixes) {
    cleanedName = cleanedName.replace(re, '');
  }

  // Remove trailing separators and collapse whitespace
  cleanedName = cleanedName.replace(/[-:–—]+$/, '').trim().replace(/\s+/g, ' ');

  return cleanedName || 'Unknown Show';
}


/**
 * Creates a URL-friendly slug from a show name.
 * @param {string} name The show name.
 * @returns {string} The slugified name.
 */
export function showSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
