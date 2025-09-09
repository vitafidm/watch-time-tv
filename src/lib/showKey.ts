

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


function runCleanup(name: string): string {
    let cleanedName = name.trim();
    
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
  
    return cleanedName;
}

const SEASON_ISH_REGEX = /^(season\s*\d+|series\s*\d+|disc\s*.+|book\s*\d+|extras?)$/i;

/**
 * Derives a clean show name from an episode's file metadata.
 * It prioritizes the parent folder name and falls back to parsing the filename.
 * @param {EpisodeLike} ep The episode metadata.
 * @returns {string} The derived show name.
 */
export function deriveShowName(ep: EpisodeLike): string {
    let derivedName = '';
    const rawPath = (ep.path || '').replace(/\\/g, '/');

    // --- Logic 1: Derive from Path ---
    if (rawPath) {
        let envTvRoot = process.env.NEXT_PUBLIC_TV_ROOT;
        if (envTvRoot) {
            // Normalize tvRoot for matching
            envTvRoot = envTvRoot.replace(/\\/g, '/').replace(/\/$/, '');
            const rootIndex = rawPath.toLowerCase().indexOf(envTvRoot.toLowerCase());

            if (rootIndex !== -1) {
                const afterRoot = rawPath.slice(rootIndex + envTvRoot.length).replace(/^\//, '');
                derivedName = afterRoot.split('/')[0];
            }
        }
        
        // If no explicit root matched, try implicit logic
        if (!derivedName) {
            const segments = rawPath.split('/').filter(Boolean);
            if (segments.length > 1) {
                let parentIndex = segments.length - 2;
                let parent = segments[parentIndex];
                
                // If the parent is a season folder, go up one level
                if (SEASON_ISH_REGEX.test(parent)) {
                    parentIndex = segments.length - 3;
                    parent = segments[parentIndex];
                }
                derivedName = parent || '';
            }
        }

        // Final safety check: if we somehow derived a season-ish name from the path, discard it
        if (SEASON_ISH_REGEX.test(derivedName)) {
            derivedName = '';
        }
    }

    // --- Logic 2: Fallback to Filename ---
    if (!derivedName) {
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
      derivedName = cutIdx > -1 ? normalizedFile.slice(0, cutIdx) : normalizedFile;
    }
    
    const finalName = runCleanup(derivedName);
    return finalName || 'Unknown Show';
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
