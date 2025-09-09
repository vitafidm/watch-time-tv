
export type MovieLike = { id: string; title?: string; filename?: string; path?: string; };

const RELEASE_TAGS = [
  '2160p','1080p','720p','480p','4k',
  'uhd','hdr','hdr10','dolby','vision','dv',
  'webrip','web-dl','webdl','bluray','bdrip','brrip','remux','dvdrip',
  'x264','x265','h264','h265','hevc','av1',
  'aac','dts','truehd','atmos',
  'yify','rarbg','evo','fgt','amzn','nf','hmax','crf'
];

function dropExtension(s: string) { return s.replace(/\.[^.]+$/, ''); }
function normalize(s: string) { return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(); }

export function cleanMovieTitle(movie: MovieLike): string {
  const raw = movie.title ?? movie.filename ?? '';
  let base = dropExtension(raw);
  base = normalize(base);

  // remove trailing group suffixes
  base = base.replace(/\s*-\s*[A-Za-z0-9._-]+$/, '');

  // remove year tokens
  base = base.replace(/\b(19\d{2}|20\d{2})\b/g, '');

  // cut off at first release/quality tag
  const parts = base.split(/\s+/);
  const idx = parts.findIndex(p => RELEASE_TAGS.includes(p.toLowerCase()));
  if (idx > -1) base = parts.slice(0, idx).join(' ');

  // tidy punctuation
  base = base
    .replace(/[-–—]+$/,'')
    .replace(/\s*\/\s*/g,' / ')
    .replace(/\s*-\s*/g,' - ')
    .replace(/\s*\.\s*/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  return base || raw;
}
