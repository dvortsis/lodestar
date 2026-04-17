/** Extract common video resolution / HDR tokens from a release title */
export function extractVideoResolutions(name: string): string[] {
  const re =
    /\b(8K|4320p|4K|UHD|2160p|1440p|1080p|720p|480p|360p|HDR10|HDR|DV|Dolby\s*Vision)\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(name)) !== null) {
    const raw = m[1].replace(/\s+/g, " ").trim();
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(raw);
    }
  }
  return out;
}
