import { query } from "@/lib/pgdb";
import {
  SEARCH_KEYWORD_SPLIT_REGEX,
  SEARCH_EXCLUDE_MAX_LENGTH,
  SEARCH_EXCLUDE_MAX_WORDS,
  SEARCH_PAGE_SIZE,
  TORRENT_FILES_PER_TORRENT_SQL_LIMIT,
} from "@/config/constant";
import {
  hasActiveDiscoveryFiltersFromQueryInput,
  normalizeFilterTimeField,
  normalizeSearchScope,
} from "@/lib/searchUrl";
import {
  COMPOSITION_CATEGORIES,
  COMPOSITION_PARAM_KEYS,
  parseCompositionParam,
} from "@/lib/compositionFilter";
import type { FileCategory } from "@/lib/fileUtils";

/**
 * Lodestar GraphQL search & torrent hydration (`service.ts`)
 *
 * **Keyword path (PGroonga):** `pgQuery` maps `|`/`OR`/`AND` to spaced ` OR ` / space **outside** `"..."`;
 * hyphen-terms quoted only when unquoted. `cleanPhrase` strips `"` then normalizes hyphens for Tier 1 / `coreWords`.
 *
 * **Preview & fallbacks:** Search rows embed a capped `files_preview` JSON slice for client “zero-cost”
 * tree open; `formatTorrent` and `torrentFiles` both implement a **single-file synthetic row** when
 * Bitmagnet stores a lone payload without a `torrent_files` row (storage optimization bypass).
 */

/** Max characters of `torrent_search_indexes.search_text` for exact-match substring boost only. */
const FTS_SIDECAR_SEARCH_TEXT_MAX_CHARS = 500_000;

/** Appended to `torrentByHash` file aggregate only (not used for search list). */
const torrentFilesSqlLimitClause =
  TORRENT_FILES_PER_TORRENT_SQL_LIMIT != null &&
  Number.isFinite(TORRENT_FILES_PER_TORRENT_SQL_LIMIT) &&
  TORRENT_FILES_PER_TORRENT_SQL_LIMIT > 0
    ? ` LIMIT ${Math.floor(TORRENT_FILES_PER_TORRENT_SQL_LIMIT)}`
    : "";

type Torrent = {
  info_hash: Buffer;
  name: string;
  size: string;
  files_count: number;
  files: TorrentFile[];
  /** First N file rows embedded in search for client hydration (see files_preview SQL). */
  files_preview?: unknown;
  /** JSONB from DB; search omits per-file rows and relies on this for composition UI */
  file_stats?: unknown;
  /** JSON object text from `torrent_compositions` join (per-category file counts). */
  composition_counts?: unknown;
  created_at: number;
  updated_at: number;
  display_name?: string;
  content_type?: string | null;
  potential_spam?: boolean;
  alternate_titles?: unknown;
  sources_json?: unknown;
};

type TorrentFile = {
  __typename?: "TorrentFile";
  index: number; // The index of the file in the torrent
  path: string; // The path of the file in the torrent
  size: string; // The size of the file in the torrent
  extension: string; // The extension of the file
};

const REGEX_PADDING_FILE = /^(_____padding_file_|\.pad\/\d+&)/; // Regular expression to identify padding files

/** Binds a value each call — returns `($n::cast)`. */
type SqlParamBinder = (val: unknown, sqlCast: string) => string;

/** Exclude-word filter against `torrent_search_indexes.search_text` (sidecar full-text source). */
function buildExcludeSql(p: SqlParamBinder, excludeWords: string[]): string {
  if (excludeWords.length === 0) {
    return "";
  }
  const patterns = excludeWords.map((w) => `%${w}%`);
  const arrPh = p(patterns, "text[]");
  return `AND NOT EXISTS (
  SELECT 1 FROM torrent_search_indexes tsi_ex
  WHERE tsi_ex.info_hash = torrents.info_hash
    AND tsi_ex.search_text ILIKE ANY (${arrPh})
)`;
}

/** Excludes, custom time/size, composition (no vacuous hybrid anchors). */
function buildWhereTail(
  p: SqlParamBinder,
  excludeWords: string[],
  filterTime: string,
  filterTimeField: "discovered" | "added",
  filterSize: string,
  queryInput: Record<string, unknown>,
  spamHideSql: string,
): string {
  const excludeSql = buildExcludeSql(p, excludeWords);

  const colExpr = timeColumnExpr(filterTimeField);
  let timeFilterSql = buildTimeFilter(filterTime, filterTimeField);
  if (filterTime === "custom") {
    const fromN = Math.floor(Number(queryInput.customTimeFrom));
    const toN = Math.floor(Number(queryInput.customTimeTo));
    const u = String(queryInput.customTimeUnit ?? "days").toLowerCase();
    const unit =
      u === "months" || u === "years" || u === "days" ? u : "days";
    if (
      Number.isFinite(fromN) &&
      Number.isFinite(toN) &&
      fromN >= 0 &&
      toN >= 0 &&
      fromN < toN
    ) {
      const mult = sqlIntervalMultiplier(unit);
      const fromPh = p(fromN, "double precision");
      const toPh = p(toN, "double precision");
      timeFilterSql = `AND (${colExpr}) BETWEEN NOW() - (${toPh} * ${mult}) AND NOW() - (${fromPh} * ${mult})`;
    }
  }

  let sizeFilterSql = buildSizeFilter(filterSize);
  if (filterSize === "custom") {
    const minN = Number(queryInput.customSizeMin);
    const maxN = Number(queryInput.customSizeMax);
    const u = String(queryInput.customSizeUnit ?? "mb").toLowerCase();
    const unit = u === "gb" ? "gb" : "mb";
    const factor = unit === "gb" ? 1024 ** 3 : 1024 ** 2;
    if (
      Number.isFinite(minN) &&
      Number.isFinite(maxN) &&
      minN >= 0 &&
      maxN >= minN
    ) {
      const minBytes = BigInt(Math.floor(minN * factor));
      const maxBytes = BigInt(Math.floor(maxN * factor));
      const minPh = p(minBytes.toString(), "bigint");
      const maxPh = p(maxBytes.toString(), "bigint");
      sizeFilterSql = `AND torrents.size >= ${minPh} AND torrents.size <= ${maxPh}`;
    }
  }

  const compositionSql = buildCompositionFilterSql(queryInput, p);

  return `
    ${excludeSql}
    ${timeFilterSql}
    ${sizeFilterSql}
    ${spamHideSql}
    ${compositionSql}`;
}

/**
 * {@link buildWhereTail} qualifies columns as `torrents.*`. `groonga_hits` uses `FROM torrents t`
 * only (no bare `torrents` range var), so filter SQL must use `t.` or Postgres raises invalid
 * FROM-clause reference errors.
 */
function whereTailSqlTorrentsToAliasT(whereTailSql: string): string {
  return whereTailSql
    .replace(/\btorrents\./g, "t.")
    .replace(/\btorrents\s+is_spam\b/gi, "t.is_spam");
}

function parseExcludeWords(raw: string): string[] {
  const trimmed = raw.trim().slice(0, SEARCH_EXCLUDE_MAX_LENGTH);
  if (!trimmed) {
    return [];
  }
  const parts = trimmed
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length > 100) {
      continue;
    }
    const key = p.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(p);
    if (out.length >= SEARCH_EXCLUDE_MAX_WORDS) {
      break;
    }
  }
  return out;
}

/** Convert DB `timestamp` / epoch ms to Unix seconds for the API (matches `created_at` / `updated_at`). */
function dbTimestampToUnixSeconds(val: unknown): number | undefined {
  if (val == null) return undefined;
  const ms =
    val instanceof Date ? val.getTime() : Number(val as string | number);
  if (!Number.isFinite(ms)) return undefined;
  return ms > 1e12 ? Math.floor(ms / 1000) : Math.floor(ms);
}

/**
 * Maps a DB search/detail row into the GraphQL `Torrent` shape.
 *
 * **Single-file preview fallback:** Bitmagnet may report `files_count === 1` while omitting file rows
 * from the preview subquery; we synthesize one `TorrentFile` from the torrent `name` + `size` so the
 * client file tree and magnet UX stay consistent without a second hop (mirrors `torrentFiles` resolver).
 */
export function formatTorrent(row: Torrent) {
  const hash = row.info_hash.toString("hex");
  const displayName =
    typeof row.display_name === "string" && row.display_name.length > 0
      ? row.display_name
      : row.name;

  let alternateTitles: string[] = [];
  if (Array.isArray(row.alternate_titles)) {
    alternateTitles = row.alternate_titles.filter(
      (x): x is string => typeof x === "string",
    );
  } else if (row.alternate_titles && typeof row.alternate_titles === "string") {
    try {
      const parsed = JSON.parse(row.alternate_titles);
      if (Array.isArray(parsed)) {
        alternateTitles = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* ignore */
    }
  }

  let sources: { source: string; seeders: number | null; leechers: number | null }[] =
    [];
  const rawSrc = row.sources_json;
  if (Array.isArray(rawSrc)) {
    sources = rawSrc.map((s: any) => ({
      __typename: "TorrentSourceRow" as const,
      source: String(s?.source ?? ""),
      seeders: s?.seeders != null ? Number(s.seeders) : null,
      leechers: s?.leechers != null ? Number(s.leechers) : null,
    }));
  }

  const more_sources_count =
    sources.length > 0 ? Math.max(0, sources.length - 1) : 0;

  const generateSingleFiles = (row: Torrent) => {
    return [
      {
        __typename: "TorrentFile" as const,
        index: 0,
        path: row.name,
        size: row.size,
        extension: row.name.split(".").pop() || "",
      },
    ];
  };

  const fileStatsJson =
    row.file_stats != null
      ? typeof row.file_stats === "string"
        ? row.file_stats
        : JSON.stringify(row.file_stats)
      : undefined;

  const compositionCountsJson =
    row.composition_counts != null
      ? typeof row.composition_counts === "string"
        ? row.composition_counts
        : JSON.stringify(row.composition_counts)
      : undefined;

  const rawFiles: TorrentFile[] = Array.isArray(row.files) ? row.files : [];

  let rawPreview: unknown = row.files_preview;
  if (typeof rawPreview === "string") {
    try {
      rawPreview = JSON.parse(rawPreview);
    } catch {
      rawPreview = [];
    }
  }
  let filesPreview: TorrentFile[] = Array.isArray(rawPreview)
    ? (rawPreview as unknown[]).map((f) => {
        const o = f as Record<string, unknown>;
        return {
          __typename: "TorrentFile" as const,
          index: Number(o.index ?? 0),
          path: String(o.path ?? ""),
          size: String(o.size ?? "0"),
          extension: String(o.extension ?? ""),
        };
      })
    : [];

  // Single-file preview fallback (Lodestar / Bitmagnet edge): monolithic torrents often have no
  // `torrent_files` preview rows even though `files_count` is 1 — fabricate the lone path from
  // `name` so `files_preview` matches client expectations and `TorrentFileTree` can hydrate.

  if (Number(row.files_count) === 1 && filesPreview.length === 0) {
    const path = String(row.name ?? "");
    filesPreview = [
      {
        __typename: "TorrentFile" as const,
        index: 0,
        path,
        size: String(row.size ?? "0"),
        extension: path.includes(".") ? path.split(".").pop() ?? "" : "",
      },
    ];
  }

  return {
    __typename: "Torrent" as const,
    hash,
    name: row.name,
    display_name: displayName !== row.name ? displayName : undefined,
    size: row.size,
    magnet_uri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(displayName)}&xl=${row.size}`,
    single_file: row.files_count <= 1,
    files_count: row.files_count || 1,
    file_stats: fileStatsJson,
    composition_counts: compositionCountsJson,
    files_preview: filesPreview,
    files: (row.files_count > 0 ? rawFiles : generateSingleFiles(row))
      .map((file) => ({
        __typename: "TorrentFile" as const,
        index: file.index,
        path: file.path,
        size: file.size,
        extension: file.extension,
      }))
      .sort((a, b) => {
        // Sorting priority: padding_file lowest -> extension empty next -> ascending index
        const aPadding = REGEX_PADDING_FILE.test(a.path) ? 1 : 0;
        const bPadding = REGEX_PADDING_FILE.test(b.path) ? 1 : 0;

        if (aPadding !== bPadding) {
          return aPadding - bPadding; // padding_file has the lowest priority
        }

        const aNoExtension = !a.extension ? 1 : 0;
        const bNoExtension = !b.extension ? 1 : 0;

        if (aNoExtension !== bNoExtension) {
          return aNoExtension - bNoExtension; // Files with no extension have lower priority
        }

        return a.index - b.index; // Within the same priority, sort by index in ascending order
      }),
    created_at: Math.floor(row.created_at / 1000),
    updated_at: Math.floor(row.updated_at / 1000),
    potential_spam: Boolean(row.potential_spam),
    alternate_titles: alternateTitles.length ? alternateTitles : undefined,
    sources: sources.length ? sources : undefined,
    more_sources_count: more_sources_count > 0 ? more_sources_count : undefined,
    content_type:
      typeof row.content_type === "string" && row.content_type.length > 0
        ? row.content_type
        : undefined,
  };
}

// Utility functions for query building
const buildOrderBy = (
  sortType: string,
  isBestMatch: boolean,
  rowAlias = "t",
) => {
  if (isBestMatch) {
    return `search_rank DESC NULLS LAST, ${rowAlias}.size DESC`;
  }
  const orderByMap: Record<string, string> = {
    size: `${rowAlias}.size DESC`,
    count: `COALESCE(${rowAlias}.files_count, 0) DESC`,
    date: `${rowAlias}.created_at DESC`,
  };
  return orderByMap[sortType] || `${rowAlias}.created_at DESC`;
};

function timeColumnExpr(filterTimeField: "discovered" | "added"): string {
  const axis = normalizeFilterTimeField(filterTimeField);
  return axis === "added" ? "torrents.updated_at" : "torrents.created_at";
}

const buildTimeFilter = (
  filterTime: string,
  filterTimeField: "discovered" | "added",
) => {
  if (filterTime === "custom") {
    return "";
  }
  const col = timeColumnExpr(filterTimeField);
  const timeFilterMap: Record<string, string> = {
    "gt-1day": `AND (${col}) > now() - interval '1 day'`,
    "gt-7day": `AND (${col}) > now() - interval '1 week'`,
    "gt-31day": `AND (${col}) > now() - interval '1 month'`,
    "gt-365day": `AND (${col}) > now() - interval '1 year'`,
  };

  return timeFilterMap[filterTime] || "";
};

/** `torrent_compositions` column for each {@link FileCategory} (1:1 sidecar on `info_hash`). */
function compositionCountColumn(cat: FileCategory): string {
  const m: Record<FileCategory, string> = {
    video: "video_count",
    audio: "audio_count",
    archive: "archive_count",
    app: "app_count",
    document: "document_count",
    image: "image_count",
    other: "other_count",
  };
  return m[cat];
}

/** Scalar subquery: category file count for `torrents` row (0 if no sidecar row). */
function compositionCountExpr(cat: FileCategory): string {
  const col = compositionCountColumn(cat);
  return `COALESCE((SELECT tc.${col} FROM torrent_compositions tc WHERE tc.info_hash = torrents.info_hash), 0)`;
}

/**
 * Composition filters: `torrent_compositions` counts for include / exclude / count-threshold;
 * legacy `torrents.custom_*_pct` only when include + size + positive percent (bytes not in sidecar).
 * Params: comp_video, comp_audio, comp_archive, comp_app, comp_document, comp_image, comp_other.
 */
function buildCompositionFilterSql(
  queryInput: Record<string, unknown>,
  bind: (v: unknown, sqlCast: string) => string,
): string {
  /** DB suffix for `torrents.custom_${dbKey}_pct` (size-metric thresholds only). */
  const categoryMap: Record<string, string> = {
    software: "app",
    unknown: "other",
    archives: "archive",
    images: "img",
    documents: "doc",
    videos: "video",
    audios: "audio",
    image: "img",
    document: "doc",
  };

  const parts: string[] = [];
  for (const cat of COMPOSITION_CATEGORIES) {
    const key = COMPOSITION_PARAM_KEYS[cat];
    const raw = queryInput[key];
    const rule = parseCompositionParam(
      raw != null ? String(raw) : undefined,
    );
    if (rule.mode === "inactive") {
      continue;
    }

    if (rule.mode === "exclude") {
      parts.push(`${compositionCountExpr(cat)} = 0`);
      continue;
    }

    if (rule.percent <= 0) {
      parts.push(`${compositionCountExpr(cat)} > 0`);
      continue;
    }

    const pctParam = bind(Number(rule.percent), "numeric");
    if (rule.metric === "size") {
      const dbKey = categoryMap[cat] || cat;
      parts.push(`COALESCE(torrents.custom_${dbKey}_pct, 0) >= ${pctParam}`);
    } else {
      parts.push(
        `((${compositionCountExpr(cat)})::numeric * 100.0 / NULLIF(torrents.files_count::numeric, 0)) >= ${pctParam}`,
      );
    }
  }
  if (parts.length === 0) {
    return "";
  }
  return `AND ${parts.join(" AND ")}`;
}

const buildSizeFilter = (filterSize: string) => {
  if (filterSize === "custom") {
    return "";
  }
  const sizeFilterMap: Record<string, string> = {
    lt100mb: "AND torrents.size < 100 * 1024 * 1024::bigint",
    "gt100mb-lt500mb":
      "AND torrents.size BETWEEN 100 * 1024 * 1024::bigint AND 500 * 1024 * 1024::bigint",
    "gt500mb-lt1gb":
      "AND torrents.size BETWEEN 500 * 1024 * 1024::bigint AND 1024 * 1024 * 1024::bigint",
    "gt1gb-lt5gb":
      "AND torrents.size BETWEEN 1 * 1024 * 1024 * 1024::bigint AND 5 * 1024 * 1024 * 1024::bigint",
    gt5gb: "AND torrents.size > 5 * 1024 * 1024 * 1024::bigint",
  };

  return sizeFilterMap[filterSize] || "";
};

function sqlIntervalMultiplier(unit: string): string {
  if (unit === "months") {
    return "interval '1 month'";
  }
  if (unit === "years") {
    return "interval '1 year'";
  }
  return "interval '1 day'";
}

/**
 * Tokens for client title highlighting only — derived from the raw query string.
 * Splits only on punctuation from {@link SEARCH_KEYWORD_SPLIT_REGEX}; does not interpret
 * boolean syntax (that is handled in Postgres via PGroonga `&@~` in keyword search).
 */
function buildSearchHighlightKeywords(raw: string): string[] {
  const t = String(raw ?? "").trim();
  if (!t) {
    return [];
  }
  const parts = [t, ...t.split(SEARCH_KEYWORD_SPLIT_REGEX)]
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 || /^\S+\*$/.test(s));
  return Array.from(new Set(parts));
}

/** Apply `fn` only to runs **outside** balanced `"..."` spans (no hyphen / AND / OR edits inside quotes). */
function replaceOutsideDoubleQuotes(
  s: string,
  fn: (unquotedFragment: string) => string,
): string {
  const re = /"[^"]*"/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  const src = String(s);
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) {
    out += fn(src.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  out += fn(src.slice(last));
  return out;
}

/**
 * PGroonga `&@~` string from the **raw** keyword:
 * - Outside `"..."`: **`|`** → **` OR `**; **` OR `** (word boundary) → uppercase spaced **` OR `**;
 *   **` AND `** → single space. Parentheses are unchanged; spaces are collapsed afterward.
 *   Example: `(Ubuntu|Debian) AND "64-bit"` → `(Ubuntu OR Debian) "64-bit"`.
 * - **Hyphen wrapping** runs only outside quotes: `64-bit` → `"64-bit"`; already-quoted `"64-bit"` is untouched.
 * - **Negation** `-term` is not matched by the hyphen pattern.
 */
function buildPgQueryFromExpanded(rawKeyword: string): string {
  let s = String(rawKeyword ?? "").trim();
  s = replaceOutsideDoubleQuotes(s, (frag) =>
    frag
      // PGroonga Tokenizer Prep: We must convert `|` to ` OR ` (with spaces)
      // so the index tokenizer doesn't crash on squished strings like '(Ubuntu|Debian)'.
      .replace(/\|/g, " OR ")
      .replace(/\bOR\b/gi, " OR ")
      .replace(/\bAND\b/gi, " "),
  );
  s = s.replace(/\s+/g, " ").trim();
  s = replaceOutsideDoubleQuotes(s, (frag) =>
    frag.replace(
      /\b([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\b/g,
      (full) => `"${full.replace(/"/g, "")}"`,
    ),
  );
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** True when **outside** `"..."` the query uses boolean / alternation syntax (not plain `(2024)`). */
function rawKeywordHasBooleanSyntaxOutsideQuotes(raw: string): boolean {
  const src = String(raw ?? "").trim();
  const re = /"[^"]*"/g;
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) {
    if (fragmentLooksBooleanQuery(src.slice(last, m.index))) {
      return true;
    }
    last = m.index + m[0].length;
  }
  return fragmentLooksBooleanQuery(src.slice(last));
}

function fragmentLooksBooleanQuery(frag: string): boolean {
  if (/\|/.test(frag) || /\bOR\b/i.test(frag) || /\bAND\b/i.test(frag)) {
    return true;
  }
  const re = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(frag)) !== null) {
    const inner = m[1];
    if (/\|/.test(inner) || /\bOR\b/i.test(inner)) {
      return true;
    }
  }
  return false;
}

/** Text before the first `\bOR\b` outside double quotes (null if none). */
function firstUnquotedOrSegment(raw: string): string | null {
  const s = String(raw ?? "").trim();
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    const tail = s.slice(i);
    if (/^\bOR\b/i.test(tail)) {
      return s.slice(0, i).trim();
    }
  }
  return null;
}

function normalizeTier1Token(s: string): string {
  let o = s
    .replace(/[()|&]/g, " ")
    .replace(/\bOR\b/gi, " ")
    .replace(/\bAND\b/gi, " ")
    .trim();
  o = o.replace(/([A-Za-z0-9])-(?=[A-Za-z0-9])/g, "$1 ");
  o = o.replace(/\s+/g, " ").trim();
  return o;
}

/**
 * Strip quotes / boolean punctuation for **core word** extraction only — always keeps **all**
 * tokens (no alternation-first shortcut). Used with `buildCoreWords` so `twc`/`fwc`
 * see every term (e.g. `Ubuntu` and `Debian`) while phrase tiers can still use {@link buildCleanPhrase}.
 */
function buildCleanPhrasePlainNoBoolean(raw: string): string {
  let s = String(raw ?? "")
    .replace(/"([^"]*)"/g, "$1")
    .replace(/[()|&]/g, " ")
    .replace(/\bOR\b/gi, " ")
    .replace(/\bAND\b/gi, " ")
    .trim();
  s = s.replace(/([A-Za-z0-9])-(?=[A-Za-z0-9])/g, "$1 ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Phrase text for Tier 1 `strpos`: strip manual `"..."` (keep inner text), then boolean punctuation;
 * turn **internal** `alnum-alnum` hyphens into spaces so titles like `64 bit` match a `64-bit` query.
 *
 * For boolean-style queries (`|`, `OR`, `AND`, or parenthesized alternation), Tier 1 substring
 * match on the full collapsed phrase is unreliable — we return a **single** seed term (first branch
 * or text before ` OR `) or `""` so SQL binds a non-matching placeholder and Tier 2+/PGroonga rank.
 */
function buildCleanPhrase(raw: string): string {
  if (rawKeywordHasBooleanSyntaxOutsideQuotes(raw)) {
    const sParen = String(raw ?? "").trim();
    const reParen = /\(([^()]*)\)/g;
    let mParen: RegExpExecArray | null;
    let altFirst: string | null = null;
    while ((mParen = reParen.exec(sParen)) !== null) {
      const inner = mParen[1].trim();
      if (!/\|/.test(inner) && !/\bOR\b/i.test(inner)) {
        continue;
      }
      const firstBranch = inner.includes("|")
        ? inner.split("|")[0]
        : inner.split(/\bOR\b/i)[0];
      const first = String(firstBranch ?? "")
        .trim()
        .replace(/^["']+|["']+$/g, "");
      if (first.length >= 2) {
        altFirst = first;
        break;
      }
    }
    if (altFirst != null) {
      let s = altFirst.replace(/([A-Za-z0-9])-(?=[A-Za-z0-9])/g, "$1 ");
      s = s.replace(/\s+/g, " ").trim();
      return s;
    }

    const orHead = firstUnquotedOrSegment(raw);
    if (orHead != null && orHead.length > 0) {
      const norm = normalizeTier1Token(orHead);
      const firstTok = norm.split(/\s+/).find((w) => w.length >= 2) ?? "";
      if (firstTok.length >= 2) {
        return firstTok;
      }
    }

    const bare = String(raw ?? "").trim();
    if (!/"[^"]*"/.test(bare) && /\|/.test(bare)) {
      const head = bare.split("|")[0]?.trim() ?? "";
      const stripped = normalizeTier1Token(head);
      if (stripped.length >= 2) {
        const firstTok = stripped.split(/\s+/).find((w) => w.length >= 2) ?? stripped;
        return firstTok.length >= 2 ? firstTok : "";
      }
    }

    return "";
  }

  return buildCleanPhrasePlainNoBoolean(raw);
}

/** Split `cleanPhrase` tokens; hyphenated tokens expand to full token + each segment (e.g. `64-bit` → `64`, `bit`, `64-bit`). */
function expandHyphenatedCoreTerms(token: string): string[] {
  const t = token.trim();
  if (t.length === 0) {
    return [];
  }
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(t)) {
    const parts = t.split("-");
    const acc: string[] = [t];
    for (const p of parts) {
      if (p.length >= 2 || /^\d+$/.test(p)) {
        acc.push(p);
      }
    }
    return Array.from(new Set(acc));
  }
  return t.length >= 2 ? [t] : [];
}

function buildCoreWords(cleanPhrase: string): string[] {
  if (!cleanPhrase) {
    return [];
  }
  const rawTokens = cleanPhrase
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of rawTokens) {
    for (const w of expandHyphenatedCoreTerms(tok)) {
      const k = w.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(w);
      }
    }
  }
  return out;
}

/**
 * Main torrent search resolver — discovery-only vs PGroonga keyword pipeline.
 *
 * Keyword mode: `pgQuery` + scope-aware `groonga_hits`, tiered `scoring_buffer`, then `ranked_page` /
 * `boosted_data` (deferred `sw`/`ct_bm`) / `filtered` for `search_rank`.
 */
export async function search(_: any, { queryInput }: any) {
  try {
    console.info("-".repeat(50));
    console.info("search params", queryInput);

    const rawKeyword = String(queryInput.keyword ?? "").trim();

    // 1. Strict boolean (WHERE / @@): expand first `(…|…)` group to disjunctive form; else `|` → OR.
    let keywordForSql = rawKeyword;
    const groupMatch = keywordForSql.match(/(.*?)\(([^)]+)\)(.*)/);

    if (groupMatch) {
      const before = groupMatch[1].trim();
      const options = groupMatch[2].split("|").map((s) => s.trim());
      const after = groupMatch[3].trim();

      keywordForSql = options
        .map((opt) => `${before} ${opt} ${after}`.trim())
        .filter(Boolean)
        .join(" OR ");
    } else {
      keywordForSql = keywordForSql.replace(/\|/g, " OR ");
    }

    // 2. Literal for exact-match boost: strip ()" ; pipes → spaces; collapse whitespace.
    const keywordLiteral = rawKeyword
      .replace(/[()"]/g, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const emptyKeywords = {
      __typename: "SearchResult" as const,
      keywords: [] as string[],
      torrents: [] as any[],
      total_count: 0,
      has_more: false,
    };

    const discoveryMode =
      rawKeyword.length < 2 &&
      hasActiveDiscoveryFiltersFromQueryInput(queryInput);

    if (rawKeyword.length < 2 && !discoveryMode) {
      return emptyKeywords;
    }

    const REGEX_HASH = /^[a-f0-9]{40}$/;

    if (rawKeyword.length === 40 && REGEX_HASH.test(rawKeyword)) {
      const torrent = await torrentByHash(_, { hash: rawKeyword });

      if (torrent) {
        return {
          __typename: "SearchResult" as const,
          keywords: [rawKeyword],
          torrents: [torrent],
          total_count: 1,
          has_more: false,
        };
      }

      return { ...emptyKeywords, keywords: [rawKeyword] };
    }

    let sortType = String(queryInput.sortType ?? "bestMatch");
    if (sortType === "default") {
      sortType = "bestMatch";
    }
    if (sortType === "originalDate") {
      sortType = "date";
    }
    const effectiveSortType =
      discoveryMode && sortType === "bestMatch" ? "date" : sortType;
    const useBestMatchRank =
      effectiveSortType === "bestMatch" && rawKeyword.length >= 2;

    const filterTime = queryInput.filterTime ?? "all";
    const filterSize = queryInput.filterSize ?? "all";
    const filterTimeField = normalizeFilterTimeField(
      queryInput.filterTimeField,
    );
    const searchScope = normalizeSearchScope(queryInput.searchScope);
    const excludeWordsEnabled =
      queryInput.excludeWordsEnabled === true ||
      String(queryInput.excludeWordsEnabled) === "1";
    const excludeWords = excludeWordsEnabled
      ? parseExcludeWords(String(queryInput.excludeWords ?? ""))
      : [];
    const hideSpam =
      queryInput.hideSpam !== false &&
      queryInput.hideSpam !== "0" &&
      String(queryInput.hideSpam).toLowerCase() !== "false";

    const spamHideSql = hideSpam ? `AND torrents.is_spam = false` : "";

    const sqlParams: unknown[] = [];
    const p: SqlParamBinder = (val, sqlCast) => {
      sqlParams.push(val);
      return `($${sqlParams.length}::${sqlCast})`;
    };

    let keywordsPlain: string[] = [];

    if (!discoveryMode) {
      keywordsPlain = buildSearchHighlightKeywords(rawKeyword);
    }

    const whereTailSql = buildWhereTail(
      p,
      excludeWords,
      filterTime,
      filterTimeField,
      filterSize,
      queryInput,
      spamHideSql,
    );

    const limitVal = Math.max(
      1,
      Math.floor(Number(queryInput.limit)) || SEARCH_PAGE_SIZE,
    );
    const offsetVal = Math.max(
      0,
      Math.floor(Number(queryInput.offset)) || 0,
    );

    let searchRankSelect: string;
    let rankJoinAndFromSql: string;
    /** Monolith keyword FTS pipeline `WITH` (includes `filtered`). */
    let bothEventHorizonWithClause = "";
    /** `COUNT(*)` for keyword search (no buffer/limit params). */
    let monolithCountSql = "";
    /**
     * `sqlParams.length` after `base` filters + **`pgQuery`** only (`groonga_hits` / count).
     * `literalPh`, `cleanPhrasePh`, `coreWordsPh` are bound later for `scoring_buffer` / `boosted_data` only.
     */
    let matchedHashesSqlParamCount: number | undefined;
    /** Keyword monolith: use `search_rank` in final `ORDER BY` when sort is best-match (matches `ranked_page` tie-break intent). */
    let monolithOuterUsesSearchRank = false;
    /**
     * `sqlParams.length` after discovery inner `FROM`, before LIMIT/OFFSET on `filtered`.
     */
    let searchInnerSqlParamCount: number | undefined;

    if (discoveryMode) {
      searchRankSelect = "0::double precision";
      rankJoinAndFromSql = `
FROM (
  SELECT torrents.*
  FROM torrents
  WHERE TRUE
    ${whereTailSql}
) t`;
      searchInnerSqlParamCount = sqlParams.length;
    } else {
      // BOOLEAN BYPASS: If the user is doing an OR/AND search, we disable the Exact/Fuzzy Phrase tiers.
      // This allows the query to fall through to the Word Count (Tier 3) where 'minRequiredWords'
      // handles the logical intersection correctly.
      const isBooleanQuery =
        /\||\bOR\b|\bAND\b|\(|\)/i.test(rawKeyword);
      const pgQuery = buildPgQueryFromExpanded(rawKeyword);
      const cleanPhrase = buildCleanPhrase(rawKeyword);
      const cleanPhrasePlainForCore = buildCleanPhrasePlainNoBoolean(rawKeyword);
      const coreWords = buildCoreWords(cleanPhrasePlainForCore);
      const orCount =
        (rawKeyword.match(/\bOR\b/gi) ?? []).length +
        (rawKeyword.match(/\|/g) ?? []).length;
      const minRequiredWords = Math.max(1, coreWords.length - orCount);

      const pgQueryPh = p(pgQuery.length > 0 ? pgQuery : " ", "text");
      matchedHashesSqlParamCount = sqlParams.length;
      const literalPh = p(keywordLiteral, "text");
      const activePhrase = isBooleanQuery ? "" : cleanPhrase;
      const cleanPhrasePh = p(activePhrase.length >= 2 ? activePhrase : " ", "text");
      const fuzzyIlikeString =
        activePhrase.trim().length > 0
          ? `%${activePhrase.trim().split(/\s+/).join("% ")}%`
          : "";
      const fuzzyIlikePh = p(fuzzyIlikeString, "text");
      const coreWordsPh = p(coreWords, "text[]");

      const pgTitleCond = `(t.name &@~ ${pgQueryPh})`;
      const pgSidecarCond = `(tsi.search_text &@~ ${pgQueryPh})`;

      const monolithUsesBestMatchRank = effectiveSortType === "bestMatch";
      monolithOuterUsesSearchRank = monolithUsesBestMatchRank;

      /**
       * `search_rank` is computed in `filtered` from `boosted_data` (never self-reference `filtered`).
       */
      const searchRankFromBoostedExpr = monolithUsesBestMatchRank
        ? `((bd.boosted_base_score::double precision * (1.0::double precision + (1.0::double precision / LN((ABS(EXTRACT(EPOCH FROM (NOW() - bd.created_at)))::double precision / 86400.0 + 2.0::double precision)))) * (CASE WHEN bd.bm_content_type IN ('movie', 'tv_show') THEN 1.2::double precision ELSE 1.0::double precision END)) + (0.1::double precision * LN(GREATEST(COALESCE(bd.swarm_seeders, 0), 0)::double precision + (GREATEST(COALESCE(bd.swarm_leechers, 0), 0)::double precision * 0.5::double precision) + 1.0::double precision)))`
        : `0::double precision`;

      const rankedPageOrderBy = monolithUsesBestMatchRank
        ? `ORDER BY tc.base_match_score DESC NULLS LAST, t.max_seeders DESC, t.size DESC`
        : `ORDER BY ${buildOrderBy(effectiveSortType, false, "t")}`;

      const boostedDataBmSelect = monolithUsesBestMatchRank
        ? `ct_bm.content_type::text AS bm_content_type`
        : `NULL::text AS bm_content_type`;

      const boostedDataScoringJoinSql = monolithUsesBestMatchRank
        ? `LEFT JOIN LATERAL (
    SELECT tc2.content_type::text AS content_type
    FROM torrent_contents tc2
    WHERE tc2.info_hash = pr.info_hash
    ORDER BY
      COALESCE(pr.max_seeders, -1) DESC,
      tc2.updated_at DESC NULLS LAST
    LIMIT 1
  ) ct_bm ON true`
        : "";

      /** `groonga_hits`: scope-filtered `&@~` on `pgQuery` only; same `whereTail` as `base` via `whereTailGroongaSql`. */
      const whereTailGroongaSql = whereTailSqlTorrentsToAliasT(whereTailSql);

      const sidecarStrExpr = `LEFT(COALESCE(tsi.search_text::text, ''), ${FTS_SIDECAR_SEARCH_TEXT_MAX_CHARS})`;

      const tier1Title = `(length(trim(${cleanPhrasePh}::text)) >= 2 AND strpos(lower(t.name::text), lower(trim(${cleanPhrasePh}::text))) > 0)`;
      const tier1TitleFuzzy = `(length(trim(${fuzzyIlikePh}::text)) >= 2 AND t.name::text ILIKE ${fuzzyIlikePh}::text)`;
      const tier2AnyWordTitle = `(cardinality(${coreWordsPh}::text[]) > 0 AND COALESCE(twc.c, 0::bigint) >= ${minRequiredWords}::bigint)`;
      const tier3Title = `gh.title_p_score > 0::double precision`;
      const tier4Files = `length(trim(${cleanPhrasePh}::text)) >= 2 AND strpos(lower(${sidecarStrExpr}), lower(trim(${cleanPhrasePh}::text))) > 0`;
      const tier4FilesFuzzy = `(length(trim(${fuzzyIlikePh}::text)) >= 2 AND (${sidecarStrExpr})::text ILIKE ${fuzzyIlikePh}::text)`;
      const tier5AnyWordFiles = `(cardinality(${coreWordsPh}::text[]) > 0 AND COALESCE(fwc.c, 0::bigint) >= ${minRequiredWords}::bigint)`;
      const tier6Files = `gh.files_p_score > 0::double precision`;

      const wordCountBonusSql = `(COALESCE(twc.c, 0::bigint)::double precision * 100000.0::double precision + COALESCE(fwc.c, 0::bigint)::double precision * 100000.0::double precision)`;

      const scoringBufferWordCountLateralsSql = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS c
    FROM unnest(${coreWordsPh}::text[]) AS w
    WHERE length(trim(w::text)) >= 2
      AND strpos(lower(t.name::text), lower(trim(w::text))) > 0
  ) twc ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS c
    FROM unnest(${coreWordsPh}::text[]) AS w
    WHERE length(trim(w::text)) >= 2
      AND strpos(lower(${sidecarStrExpr}), lower(trim(w::text))) > 0
  ) fwc ON true`;

      const tierScoreCaseTitleSql = `(
  (
    CASE
      WHEN ${tier1Title} THEN 100000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier1TitleFuzzy} THEN 75000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier2AnyWordTitle} THEN 50000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier3Title} THEN 10000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      ELSE 0.0::double precision
    END
  ) + ${wordCountBonusSql}
)::double precision`;

      const matchTierCaseTitleSql = `(
  CASE
    WHEN ${tier1Title} THEN 1
    WHEN ${tier1TitleFuzzy} THEN 2
    WHEN ${tier2AnyWordTitle} THEN 3
    WHEN ${tier3Title} THEN 4
    ELSE 0
  END
)`;

      const tierScoreCaseFilesSql = `(
  (
    CASE
      WHEN ${tier4Files} THEN LEAST(1500000.0::double precision, 1000000.0::double precision + (gh.files_p_score * 10.0::double precision))
      WHEN ${tier4FilesFuzzy} THEN LEAST(1250000.0::double precision, 750000.0::double precision + (gh.files_p_score * 10.0::double precision))
      WHEN ${tier5AnyWordFiles} THEN 500000.0::double precision + (gh.files_p_score * 10.0::double precision)
      WHEN ${tier6Files} THEN 10000.0::double precision + (gh.files_p_score * 10.0::double precision)
      ELSE 0.0::double precision
    END
  ) + ${wordCountBonusSql}
)::double precision`;

      const matchTierCaseFilesSql = `(
  CASE
    WHEN ${tier4Files} THEN 5
    WHEN ${tier4FilesFuzzy} THEN 6
    WHEN ${tier5AnyWordFiles} THEN 7
    WHEN ${tier6Files} THEN 8
    ELSE 0
  END
)`;

      const tierScoreCaseBothSql = `(
  (
    CASE
      WHEN ${tier1Title} THEN 100000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier1TitleFuzzy} THEN 75000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier2AnyWordTitle} THEN 50000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier3Title} THEN 10000000.0::double precision + (gh.title_p_score * 10.0::double precision)
      WHEN ${tier4Files} THEN LEAST(1500000.0::double precision, 1000000.0::double precision + (gh.files_p_score * 10.0::double precision))
      WHEN ${tier4FilesFuzzy} THEN LEAST(1250000.0::double precision, 750000.0::double precision + (gh.files_p_score * 10.0::double precision))
      WHEN ${tier5AnyWordFiles} THEN 500000.0::double precision + (gh.files_p_score * 10.0::double precision)
      WHEN ${tier6Files} THEN 10000.0::double precision + (gh.files_p_score * 10.0::double precision)
      ELSE 0.0::double precision
    END
  ) + ${wordCountBonusSql}
)::double precision`;

      const matchTierCaseBothSql = `(
  CASE
    WHEN ${tier1Title} THEN 1
    WHEN ${tier1TitleFuzzy} THEN 2
    WHEN ${tier2AnyWordTitle} THEN 3
    WHEN ${tier3Title} THEN 4
    WHEN ${tier4Files} THEN 5
    WHEN ${tier4FilesFuzzy} THEN 6
    WHEN ${tier5AnyWordFiles} THEN 7
    WHEN ${tier6Files} THEN 8
    ELSE 0
  END
)`;

      let scoringBufferFromJoinSql: string;
      let tierScoreCaseSql: string;
      let matchTierCaseSql: string;
      if (searchScope === "title") {
        scoringBufferFromJoinSql = `
  FROM base b
  INNER JOIN groonga_hits gh ON b.info_hash = gh.info_hash
  INNER JOIN torrents t ON t.info_hash = b.info_hash
  LEFT JOIN torrent_search_indexes tsi ON tsi.info_hash = b.info_hash${scoringBufferWordCountLateralsSql}`;
        tierScoreCaseSql = tierScoreCaseTitleSql;
        matchTierCaseSql = matchTierCaseTitleSql;
      } else if (searchScope === "files") {
        scoringBufferFromJoinSql = `
  FROM base b
  INNER JOIN groonga_hits gh ON b.info_hash = gh.info_hash
  INNER JOIN torrents t ON t.info_hash = b.info_hash
  INNER JOIN torrent_search_indexes tsi ON tsi.info_hash = b.info_hash${scoringBufferWordCountLateralsSql}`;
        tierScoreCaseSql = tierScoreCaseFilesSql;
        matchTierCaseSql = matchTierCaseFilesSql;
      } else {
        scoringBufferFromJoinSql = `
  FROM base b
  INNER JOIN groonga_hits gh ON b.info_hash = gh.info_hash
  INNER JOIN torrents t ON t.info_hash = b.info_hash
  LEFT JOIN torrent_search_indexes tsi ON tsi.info_hash = b.info_hash${scoringBufferWordCountLateralsSql}`;
        tierScoreCaseSql = tierScoreCaseBothSql;
        matchTierCaseSql = matchTierCaseBothSql;
      }

      const groongaHitsInnerSql =
        searchScope === "title"
          ? `
  SELECT
    t.info_hash,
    pgroonga_score(t.tableoid, t.ctid)::double precision AS title_p_score,
    0.0::double precision AS files_p_score
  FROM torrents t
  WHERE TRUE
    ${whereTailGroongaSql}
    AND ${pgTitleCond}`
          : searchScope === "files"
            ? `
  SELECT
    t.info_hash,
    0.0::double precision AS title_p_score,
    pgroonga_score(tsi.tableoid, tsi.ctid)::double precision AS files_p_score
  FROM torrent_search_indexes tsi
  INNER JOIN torrents t ON t.info_hash = tsi.info_hash
  WHERE TRUE
    ${whereTailGroongaSql}
    AND ${pgSidecarCond}`
            : `
  SELECT
    u.info_hash,
    MAX(u.title_p_score)::double precision AS title_p_score,
    MAX(u.files_p_score)::double precision AS files_p_score
  FROM (
    SELECT
      t.info_hash,
      pgroonga_score(t.tableoid, t.ctid)::double precision AS title_p_score,
      0.0::double precision AS files_p_score
    FROM torrents t
    WHERE TRUE
      ${whereTailGroongaSql}
      AND ${pgTitleCond}
    UNION ALL
    SELECT
      t.info_hash,
      0.0::double precision AS title_p_score,
      pgroonga_score(tsi.tableoid, tsi.ctid)::double precision AS files_p_score
    FROM torrent_search_indexes tsi
    INNER JOIN torrents t ON t.info_hash = tsi.info_hash
    WHERE TRUE
      ${whereTailGroongaSql}
      AND ${pgSidecarCond}
  ) u
  GROUP BY u.info_hash`;

      const exactFileBoostPr =
        searchScope === "title"
          ? `0.0::double precision`
          : `(CASE WHEN length(${literalPh}::text) > 0 AND strpos(lower(LEFT(tsi.search_text::text, ${FTS_SIDECAR_SEARCH_TEXT_MAX_CHARS})), lower(${literalPh}::text)) > 0 THEN 25000.0::double precision ELSE 0.0::double precision END)`;

      const filteredTsiJoin =
        searchScope === "title"
          ? ""
          : `
  LEFT JOIN torrent_search_indexes tsi ON tsi.info_hash = pr.info_hash`;

      searchRankSelect = "0::double precision";
      rankJoinAndFromSql = "";

      monolithCountSql = `
WITH base AS (
  SELECT torrents.*
  FROM torrents
  WHERE TRUE
    ${whereTailSql}
),
groonga_hits AS (
  ${groongaHitsInnerSql}
)
SELECT COUNT(*)::bigint AS total
FROM base b
INNER JOIN groonga_hits gh ON b.info_hash = gh.info_hash
`;

      bothEventHorizonWithClause = `
base AS (
  SELECT torrents.*
  FROM torrents
  WHERE TRUE
    ${whereTailSql}
),
groonga_hits AS (
  ${groongaHitsInnerSql}
),
/* RELEVANCE TIERS (Title beats Files, Exact beats Fuzzy):
  1. 100M: Exact Phrase Match (strpos)
  2.  75M: Fuzzy Ordered Phrase (ILIKE '%word1% word2%')
  3.  50M: All Words Match (minRequiredWords logic via lateral join)
  4.  10M: PGroonga Partial Hit
  (Tiers 5-8 mirror this for Files, capped at 1.5M points)
*/
scoring_buffer AS (
  SELECT
    b.info_hash,
    b.size,
    b.max_seeders,
    gh.title_p_score AS title_score,
    gh.files_p_score AS files_score,
    ${tierScoreCaseSql} AS base_match_score,
    ${matchTierCaseSql} AS match_tier
  ${scoringBufferFromJoinSql}
),
ranked_page AS (
  SELECT
    tc.info_hash,
    tc.base_match_score,
    tc.size,
    tc.max_seeders,
    t.name,
    t.created_at,
    t.updated_at,
    t.files_count,
    t.file_stats,
    t.is_spam AS potential_spam
  FROM scoring_buffer tc
  INNER JOIN torrents t ON t.info_hash = tc.info_hash
  ${rankedPageOrderBy}
  LIMIT ${p(limitVal, "int")}
  OFFSET ${p(offsetVal, "int")}
),
boosted_data AS (
  SELECT
    pr.info_hash,
    pr.name,
    pr.size,
    pr.created_at,
    pr.updated_at,
    pr.files_count,
    pr.file_stats,
    pr.potential_spam,
    pr.max_seeders,
    pr.base_match_score,
    (pr.base_match_score + ${exactFileBoostPr})::double precision AS boosted_base_score,
    COALESCE(sw.swarm_seeders, 0) AS swarm_seeders,
    COALESCE(sw.swarm_leechers, 0) AS swarm_leechers,
    ${boostedDataBmSelect}
  FROM ranked_page pr
  ${filteredTsiJoin}
  LEFT JOIN LATERAL (
    SELECT
      MAX(tts.seeders) AS swarm_seeders,
      MAX(tts.leechers) AS swarm_leechers
    FROM torrents_torrent_sources tts
    WHERE tts.info_hash = pr.info_hash
  ) sw ON true
  ${boostedDataScoringJoinSql}
),
filtered AS (
  SELECT
    bd.info_hash,
    bd.name,
    bd.size,
    bd.created_at,
    bd.updated_at,
    bd.files_count,
    bd.file_stats,
    bd.potential_spam,
    bd.boosted_base_score AS base_match_score,
    bd.swarm_seeders,
    bd.swarm_leechers,
    ${searchRankFromBoostedExpr} AS search_rank
  FROM boosted_data bd
)`;
    }

    const orderByClause = buildOrderBy(
      effectiveSortType,
      useBestMatchRank,
      "t",
    );

    const outerSelectFromFiltered = `
SELECT
  filtered.info_hash,
  COALESCE(dn.chosen_title, filtered.name) AS display_name,
  filtered.name,
  filtered.size,
  filtered.created_at,
  filtered.updated_at,
  filtered.files_count,
  filtered.file_stats,
  json_build_object(
    'video', COALESCE(tcmp.video_count, 0),
    'audio', COALESCE(tcmp.audio_count, 0),
    'image', COALESCE(tcmp.image_count, 0),
    'document', COALESCE(tcmp.document_count, 0),
    'archive', COALESCE(tcmp.archive_count, 0),
    'app', COALESCE(tcmp.app_count, 0),
    'other', COALESCE(tcmp.other_count, 0)
  )::text AS composition_counts,
  filtered.potential_spam AS potential_spam,
  ct.content_type,
  COALESCE(alt.titles, '[]'::json) AS alternate_titles,
  COALESCE(src.rows, '[]'::json) AS sources_json,
  '[]'::json AS files,
  (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'path', tf.path,
          'size', tf.size,
          'index', tf.index,
          'extension', COALESCE(tf.extension::text, '')
        )
        ORDER BY tf.index
      ),
      '[]'::json
    )
    FROM (
      SELECT path, size, index, extension
      FROM torrent_files
      WHERE info_hash = filtered.info_hash
      ORDER BY index ASC
      LIMIT 20
    ) tf
  ) AS files_preview
  /* Lodestar: files_preview = first N torrent_files rows (zero-cost accordion); tail via torrentFiles + client IO */
FROM filtered
LEFT JOIN torrent_compositions tcmp ON tcmp.info_hash = filtered.info_hash
LEFT JOIN LATERAL (
  SELECT tc.content_type::text AS content_type
  FROM torrent_contents tc
  WHERE tc.info_hash = filtered.info_hash
  ORDER BY
    COALESCE(filtered.swarm_seeders, -1) DESC,
    tc.updated_at DESC NULLS LAST
  LIMIT 1
) ct ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      NULLIF(trim(both FROM c.title::text), ''),
      filtered.name::text
    ) AS chosen_title
  FROM torrent_contents tc
  LEFT JOIN content c
    ON tc.content_type IS NOT NULL
    AND tc.content_source IS NOT NULL
    AND tc.content_id IS NOT NULL
    AND tc.content_type = c.type
    AND tc.content_source = c.source
    AND tc.content_id = c.id
  WHERE tc.info_hash = filtered.info_hash
  ORDER BY
    COALESCE(filtered.swarm_seeders, -1) DESC,
    tc.updated_at DESC NULLS LAST,
    LENGTH(COALESCE(
      NULLIF(trim(both FROM c.title::text), ''),
      ''
    )) DESC
  LIMIT 1
) dn ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(
    (SELECT json_agg(sub.lbl ORDER BY sub.lbl)
     FROM (
       SELECT DISTINCT s.lbl
       FROM (
         SELECT
           NULLIF(trim(both FROM c2.title::text), '') AS lbl
         FROM torrent_contents tc2
         LEFT JOIN content c2
           ON tc2.content_type IS NOT NULL
           AND tc2.content_source IS NOT NULL
           AND tc2.content_id IS NOT NULL
           AND tc2.content_type = c2.type
           AND tc2.content_source = c2.source
           AND tc2.content_id = c2.id
         WHERE tc2.info_hash = filtered.info_hash
       ) s
       WHERE s.lbl IS NOT NULL
       AND s.lbl <> filtered.name::text
       AND (dn.chosen_title IS NULL OR s.lbl IS DISTINCT FROM dn.chosen_title)
     ) sub
    ),
    '[]'::json
  ) AS titles
) alt ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'source', s.source,
        'seeders', s.seeders,
        'leechers', s.leechers
      )
      ORDER BY s.seeders DESC NULLS LAST, s.source
    ),
    '[]'::json
  ) AS rows
  FROM torrents_torrent_sources s
  WHERE s.info_hash = filtered.info_hash
) src ON true
`;

    /** Snapshot before `LIMIT`/`OFFSET` placeholders on non-monolith main queries. */
    const countParamsForTotal =
      matchedHashesSqlParamCount !== undefined
        ? sqlParams.slice(0, matchedHashesSqlParamCount)
        : sqlParams.slice(0, searchInnerSqlParamCount ?? sqlParams.length);

    const monolithFinalOrderBy = buildOrderBy(
      effectiveSortType,
      monolithOuterUsesSearchRank,
      "filtered",
    );

    const sql =
      bothEventHorizonWithClause !== ""
        ? `WITH ${bothEventHorizonWithClause}${outerSelectFromFiltered}
ORDER BY ${monolithFinalOrderBy};`
        : `
WITH filtered AS (
  SELECT
    t.info_hash,
    t.name,
    t.size,
    t.created_at,
    t.updated_at,
    t.files_count,
    t.file_stats,
    t.is_spam AS potential_spam,
    ${searchRankSelect} AS search_rank
  ${rankJoinAndFromSql}
  ORDER BY ${orderByClause}
  LIMIT ${p(limitVal, "int")}
  OFFSET ${p(offsetVal, "int")}
)${outerSelectFromFiltered};`;

    const params = sqlParams;

    console.log("[search] SQL:", sql);
    console.debug("keywords:", keywordsPlain);

    const queryArr = [query(sql, params)];

    if (queryInput.withTotalCount) {
      const countSql =
        monolithCountSql !== ""
          ? monolithCountSql
          : `
SELECT COUNT(*)::bigint AS total
FROM (
  SELECT 1
  ${rankJoinAndFromSql}
) _search_groups;
`;

      queryArr.push(query(countSql, countParamsForTotal));
    } else {
      queryArr.push(Promise.resolve({ rows: [{ total: 0 }] }) as any);
    }

    // Execute queries and process results
    const [{ rows: torrentsResp }, { rows: countResp }] =
      await Promise.all(queryArr);

    const torrents = torrentsResp.map(formatTorrent);
    const total_count = Number(countResp[0].total ?? 0);

    const has_more =
      queryInput.withTotalCount &&
      queryInput.offset + queryInput.limit < total_count;

    return {
      __typename: "SearchResult" as const,
      keywords: discoveryMode ? [] : keywordsPlain,
      torrents,
      total_count,
      has_more,
    };
  } catch (error) {
    console.error("Error in search resolver:", error);
    throw new Error("Failed to execute search query");
  }
}

type TorrentFilesArgs = {
  infoHash: string;
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
};

/**
 * Paginated `torrent_files` for one torrent. Optional `search` only affects sort order
 * (matches first) and client highlighting — never filters rows, so title-only search hits
 * still load the full file list.
 *
 * **Single-file DB absence:** When Bitmagnet stores a single payload with **no** `torrent_files` rows
 * (count query is 0 but the torrent exists), we return one **synthetic** file built from `torrents.name`
 * + `size` — same contract as `formatTorrent`’s preview fallback so the UI never shows an empty tree
 * for legitimate single-file magnets.
 */
export async function torrentFiles(_: unknown, args: TorrentFilesArgs) {
  try {
    const rawLimit = args.limit ?? 200;
    const limit = Math.min(Math.max(Number(rawLimit) || 200, 1), 500);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const searchRaw = (args.search ?? "").trim();
    const searchParam: string | null = searchRaw.length > 0 ? searchRaw : null;

    const hash = args.infoHash.trim();
    if (!/^[0-9a-fA-F]{40}$/.test(hash)) {
      return {
        __typename: "TorrentFilesPage" as const,
        files: [],
        total_count: 0,
      };
    }

    const countSql = `
SELECT COUNT(*)::bigint AS c
FROM torrent_files tf
WHERE tf.info_hash = decode($1::text, 'hex');
    `;
    const { rows: countRows } = await query(countSql, [hash]);
    let total_count = Number(countRows[0]?.c ?? 0);

    // No `torrent_files` rows — still may be a single-file torrent stored only on `torrents`.
    // Synthesize one row so clients match search-preview behavior (Bitmagnet storage optimization).

    if (total_count === 0) {
      const { rows: torrentRows } = await query(
        `SELECT t.name::text AS name, t.size::text AS size
         FROM torrents t
         WHERE t.info_hash = decode($1::text, 'hex')
         LIMIT 1`,
        [hash],
      );
      const tr = torrentRows[0] as
        | { name?: unknown; size?: unknown }
        | undefined;
      if (!tr) {
        return {
          __typename: "TorrentFilesPage" as const,
          files: [],
          total_count: 0,
        };
      }
      const path = String(tr.name ?? "");
      const synthetic: TorrentFile[] = [
        {
          __typename: "TorrentFile" as const,
          index: 0,
          path,
          size: String(tr.size ?? "0"),
          extension: path.includes(".") ? path.split(".").pop() ?? "" : "",
        },
      ];
      total_count = 1;
      const files =
        offset < synthetic.length
          ? synthetic.slice(offset, offset + limit)
          : [];
      return {
        __typename: "TorrentFilesPage" as const,
        files,
        total_count,
      };
    }

    const dataSql =
      searchParam === null
        ? `
SELECT
  tf.index,
  tf.path::text AS path,
  tf.size::text AS size,
  tf.extension::text AS extension
FROM torrent_files tf
WHERE tf.info_hash = decode($1::text, 'hex')
ORDER BY tf.index ASC
LIMIT $2::int OFFSET $3::int;
      `
        : `
SELECT
  tf.index,
  tf.path::text AS path,
  tf.size::text AS size,
  tf.extension::text AS extension
FROM torrent_files tf
WHERE tf.info_hash = decode($1::text, 'hex')
ORDER BY
  CASE
    WHEN tf.path ILIKE '%' || $2::text || '%' THEN 0
    ELSE 1
  END,
  tf.index ASC
LIMIT $3::int OFFSET $4::int;
      `;

    const data = await query(
      dataSql,
      searchParam === null
        ? [hash, limit, offset]
        : [hash, searchParam, limit, offset],
    );
    const rows = data.rows as Record<string, unknown>[];

    const files: TorrentFile[] = rows.map((row) => ({
      __typename: "TorrentFile" as const,
      index: Number(row.index ?? 0),
      path: String(row.path ?? ""),
      size: String(row.size ?? "0"),
      extension: String(row.extension ?? ""),
    }));

    return {
      __typename: "TorrentFilesPage" as const,
      files,
      total_count,
    };
  } catch (error) {
    console.error("Error in torrentFiles resolver:", error);
    throw new Error("Failed to fetch torrent files");
  }
}

export async function torrentByHash(_: any, { hash }: { hash: string }) {
  try {
    // SQL query to fetch torrent data and files information by hash
    const sql = `
SELECT
  t.info_hash,
  t.name,
  t.size,
  t.created_at,
  t.updated_at,
  t.files_count,
  t.file_stats,
  json_build_object(
    'video', COALESCE(tcmp.video_count, 0),
    'audio', COALESCE(tcmp.audio_count, 0),
    'image', COALESCE(tcmp.image_count, 0),
    'document', COALESCE(tcmp.document_count, 0),
    'archive', COALESCE(tcmp.archive_count, 0),
    'app', COALESCE(tcmp.app_count, 0),
    'other', COALESCE(tcmp.other_count, 0)
  )::text AS composition_counts,
  (
    SELECT COALESCE(
      json_agg(json_build_object(
        'index', f.index,
        'path', f.path,
        'size', f.size,
        'extension', f.extension
      ) ORDER BY f.index),
      '[]'::json
    )
    FROM torrent_files f
    WHERE f.info_hash = t.info_hash${torrentFilesSqlLimitClause}
  ) AS files
FROM torrents t
LEFT JOIN torrent_compositions tcmp ON tcmp.info_hash = t.info_hash
WHERE t.info_hash = decode($1::text, 'hex');
    `;

    const params = [hash];

    const { rows } = await query(sql, params);
    const torrent = rows[0];

    if (!torrent) {
      return null;
    }

    return formatTorrent(torrent);
  } catch (error) {
    console.error("Error in torrentByHash resolver:", error);
    throw new Error("Failed to fetch torrent by hash");
  }
}

export async function statsInfo() {
  try {
    const sql = `
WITH db_size AS (
  SELECT pg_database_size('bitmagnet') AS size
),
torrent_count AS (
  SELECT COUNT(*) AS total_count FROM torrents
),
latest_torrent AS (
  SELECT *
    FROM torrents
    ORDER BY created_at DESC
    LIMIT 1
)
SELECT 
  db_size.size,
  latest_torrent.created_at as updated_at,
  torrent_count.total_count,
  encode(latest_torrent.info_hash, 'hex') AS latest_torrent_hash,
  json_build_object(
    'hash', encode(latest_torrent.info_hash, 'hex'),
    'name', latest_torrent.name,
    'size', latest_torrent.size,
    'created_at', latest_torrent.created_at,
    'updated_at', latest_torrent.updated_at
  ) AS latest_torrent
FROM 
  db_size,
  torrent_count,
  latest_torrent;
    `;

    const { rows } = await query(sql, []);
    const data = rows[0];

    if (!data) {
      return null;
    }

    return {
      ...data,
      __typename: "statsInfoResult" as const,
      updated_at: Math.floor(new Date(data.updated_at).getTime() / 1000),
      latest_torrent: {
        ...data.latest_torrent,
        __typename: "Torrent" as const,
        created_at: Math.floor(
          new Date(data.latest_torrent.created_at).getTime() / 1000,
        ),
        updated_at: Math.floor(
          new Date(data.latest_torrent.updated_at).getTime() / 1000,
        ),
      },
    };
  } catch (error) {
    console.error("Error in statsInfo resolver:", error);
    throw new Error("Failed to fetch torrents count");
  }
}
