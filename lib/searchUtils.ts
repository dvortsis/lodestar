/**
 * Highlight helpers for search titles. PGroonga query syntax may include `*`
 * as a suffix wildcard (e.g. `comput*`); those must not be stripped for display logic.
 */

/** `word*` with a single trailing star and no inner `*` (simple prefix wildcard). */
export function isSimplePrefixWildcardToken(t: string): boolean {
  const s = t.trim();
  return s.length >= 2 && s.endsWith("*") && !s.slice(0, -1).includes("*");
}

/**
 * First occurrence of `stem` as a prefix of a “word” (letters/digits after `stem`).
 * `stem` is already without the trailing `*`.
 */
export function findPrefixWordMatch(
  haystack: string,
  stem: string,
): { idx: number; len: number } | null {
  if (!stem) {
    return null;
  }
  const lower = haystack.toLowerCase();
  const stemL = stem.toLowerCase();
  const isWordChar = (c: string) => /[A-Za-z0-9]/.test(c);

  let i = 0;
  while (i < lower.length) {
    const j = lower.indexOf(stemL, i);
    if (j === -1) {
      return null;
    }
    const prevOk = j === 0 || !isWordChar(haystack[j - 1]!);
    if (prevOk) {
      let end = j + stemL.length;
      while (end < haystack.length && isWordChar(haystack[end]!)) {
        end += 1;
      }
      return { idx: j, len: end - j };
    }
    i = j + 1;
  }
  return null;
}
