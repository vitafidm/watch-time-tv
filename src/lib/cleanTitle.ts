
export function cleanTitleFromFilename(s: string) {
  let t = s.replace(/\.[a-z0-9]{2,4}$/i, ""); // remove extension
  t = t.replace(/\./g, " ");                  // dots -> spaces
  // only split on " - " (space-hyphen-space), not hyphens inside words
  if (t.includes(" - ")) t = t.split(" - ")[0];
  // drop trailing year or bracketed year
  t = t.replace(/\(\d{4}\)\s*$/, "");
  t = t.replace(/\b(19|20)\d{2}\b$/, "");
  // drop common tags
  t = t.replace(/\b(1080p|720p|2160p|4k|webrip|web-dl|bluray|x264|x265)\b/gi, "");
  return t.replace(/\s{2,}/g, " ").trim();
}
