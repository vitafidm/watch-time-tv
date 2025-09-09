
export type EpisodeLike = {
  id: string;
  title?: string;      // often the filename without extension
  filename?: string;   // full filename with extension
  path?: string;       // full file path
};

const TV_ROOT_DEFAULT = '/media/TV/';

function normalizeBase(str: string): string {
  // replace separators with spaces, collapse whitespace
  return str
    .replace(/\.[^.]+$/, '')            // drop extension
    .replace(/[._]+/g, ' ')             // dots/underscores -> space
    .replace(/\s+/g, ' ')               // collapse spaces
    .trim();
}

export function deriveShowName(ep: EpisodeLike, opts?: { tvRoot?: string }): string {
  const tvRoot = (opts?.tvRoot ?? process.env.NEXT_PUBLIC_TV_ROOT ?? TV_ROOT_DEFAULT)
    .replace(/\\/g, '/');

  const baseRaw = ep.filename ?? ep.title ?? '';
  let base = normalizeBase(baseRaw);

  // Episode token patterns (ordered, earliest match wins)
  const patterns = [
    /\bS\d{1,2}E\d{1,2}\b/i,   // S03E19 / s05e23
    /\b\d{1,2}x\d{1,2}\b/i,    // 6x11
    /\bSeason\s*\d+\b/i,       // Season 5
  ];

  let cutIdx = -1;
  for (const re of patterns) {
    const m = re.exec(base);
    if (m) {
      cutIdx = (cutIdx === -1) ? m.index : Math.min(cutIdx, m.index);
    }
  }

  let name = '';
  if (cutIdx > -1) {
    name = base.slice(0, cutIdx);
  } else if (ep.path && ep.path.includes(tvRoot)) {
    // Fallback: folder after TV root
    const after = ep.path.slice(ep.path.indexOf(tvRoot) + tvRoot.length);
    const firstFolder = after.split('/')[0] || '';
    // Also remove any year in parenthesis like (2023)
    name = firstFolder.replace(/\s*\(\d{4}\)\s*$/, '');
  } else {
    // last-resort: take first segment before a dash
    name = base.split('-')[0];
  }

  // Clean trailing separators and extra spaces
  name = name.replace(/[-:–—]+$/,'').trim();
  name = name.replace(/\s+/g,' ');

  return name || 'Unknown Show';
}

export function showSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
