import { query } from "@/lib/pgdb";
import { jiebaCut } from "@/lib/jieba";
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
import {
  extensionsForCompositionExclude,
  type FileCategory,
} from "@/lib/fileUtils";

/**
 * Lodestar GraphQL search & torrent hydration (`service.ts`)
 *
 * **PGroonga tiering (keyword path):** Title hits, file-path hits (sidecar `torrent_search_indexes`),
 * and dual-axis matches are merged, then scored with explicit **Gold / Silver / Bronze** bands in
 * `base_match_score` (dual hit ≫ title-only ≫ files-only). A bounded `scoring_buffer` caps work
 * before pagination so heavy `pgroonga_score` + lateral joins do not run across the whole corpus.
 *
 * **Preview & fallbacks:** Search rows embed a capped `files_preview` JSON slice for client “zero-cost”
 * tree open; `formatTorrent` and `torrentFiles` both implement a **single-file synthetic row** when
 * Bitmagnet stores a lone payload without a `torrent_files` row (storage optimization bypass).
 */

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

export type HybridTsParts = {
  /** Joined with ` & ` for to_tsquery('simple', …), e.g. `duolingo:*` */
  prefixToTsquery: string | null;
  /** Remainder passed to websearch_to_tsquery */
  websearchRemainder: string | null;
};

/**
 * Words ending with `*` and a stem of ≥3 chars become prefix lexemes (`stem:*`).
 * Other tokens are passed through for websearch_to_tsquery (phrases, OR, -exclude, etc.).
 */
export function parseHybridQuery(input: string): HybridTsParts {
  const trimmed = input.trim();
  if (!trimmed) {
    return { prefixToTsquery: null, websearchRemainder: null };
  }

  const tokens = trimmed.split(/\s+/);
  const prefixes: string[] = [];
  const webToks: string[] = [];

  for (const tok of tokens) {
    if (tok.endsWith("*") && tok.length > 1) {
      const stem = tok.slice(0, -1);
      if (stem.length >= 3) {
        const safe = stem
          .replace(/[^\p{L}\p{N}_-]/gu, "")
          .toLowerCase();
        if (safe.length >= 3) {
          prefixes.push(`${safe}:*`);
          continue;
        }
      }
    }
    webToks.push(tok);
  }

  return {
    prefixToTsquery: prefixes.length > 0 ? prefixes.join(" & ") : null,
    websearchRemainder: webToks.length > 0 ? webToks.join(" ") : null,
  };
}

/** Binds a value each call — returns `($n::cast)`. */
type SqlParamBinder = (val: unknown, sqlCast: string) => string;

/** Exclude-word filter against `torrent_search_indexes.search_text` (sidecar PGroonga source). */
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

/**
 * Composition filters: custom `torrents.custom_*_pct` for size rules, Bitmagnet `comp_*_count_pct`
 * for count rules, and `torrents.contained_extensions` for exclusions (`&&`).
 * Params: comp_video, comp_audio, comp_archive, comp_app, comp_document, comp_image, comp_other.
 */
function buildCompositionFilterSql(
  queryInput: Record<string, unknown>,
  bind: (v: unknown, sqlCast: string) => string,
): string {
  const categoryMap: Record<string, string> = {
    software: "app",
    unknown: "other",
    archives: "archive",
    images: "img",
    documents: "doc",
    videos: "video",
    audios: "audio",
    /** `FileCategory` uses singular keys; align with DB suffixes (`custom_img_pct`, etc.). */
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
    const exts = extensionsForCompositionExclude(cat as FileCategory);

    if (rule.mode === "exclude") {
      if (exts.length === 0) {
        continue;
      }
      const arrayParam = bind(exts, "text[]");
      parts.push(`NOT (torrents.contained_extensions && ${arrayParam})`);
      continue;
    }

    const dbKey = categoryMap[cat] || cat;

    if (rule.percent <= 0) {
      parts.push(`COALESCE(torrents.custom_${dbKey}_pct, 0) > 0`);
      continue;
    }

    const pctParam = bind(Number(rule.percent), "numeric");
    if (rule.metric === "size") {
      parts.push(`torrents.custom_${dbKey}_pct >= ${pctParam}`);
    } else {
      parts.push(`torrents.comp_${dbKey}_count_pct >= ${pctParam}`);
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

const QUOTED_KEYWORD_REGEX = /"([^"]+)"/g;

const extractKeywords = (
  keyword: string,
): { keyword: string; required: boolean }[] => {
  let keywords = [];
  let match;

  // Extract exact keywords using quotation marks
  while ((match = QUOTED_KEYWORD_REGEX.exec(keyword)) !== null) {
    keywords.push({ keyword: match[1], required: true });
  }

  const remainingKeywords = keyword.replace(QUOTED_KEYWORD_REGEX, "");

  // Extract remaining keywords using regex tokenizer
  keywords.push(
    ...remainingKeywords
      .trim()
      .split(SEARCH_KEYWORD_SPLIT_REGEX)
      .map((k) => ({ keyword: k, required: false })),
  );

  // Use jieba to words segment if input is a full sentence (skip when PGroonga operators present — preserves `comput*`, etc.)
  if (
    keywords.length === 1 &&
    keyword.length >= 4 &&
    !/[*^|()~]/.test(keyword)
  ) {
    keywords.push(...jiebaCut(keyword));
  }

  // Remove duplicates and filter out keywords shorter than 2 characters to avoid slow SQL queries
  keywords = Array.from(
    new Map(keywords.map((k) => [k.keyword, k])).values(),
  ).filter(({ keyword }) => keyword.trim().length >= 2);

  // Ensure at least 1/3 keyword is required when there is no required keyword
  if (keywords.length && !keywords.some(({ required }) => required)) {
    [...keywords]
      .sort((a, b) => b.keyword.length - a.keyword.length)
      .slice(0, Math.ceil(keywords.length / 3))
      .forEach((k) => (k.required = true));
  }

  const fullKeyword = keyword.replace(/"/g, "");

  // Ensure full keyword is the first item
  if (!keywords.some((k) => k.keyword === fullKeyword)) {
    keywords.unshift({ keyword: fullKeyword, required: false });
  }

  return keywords;
};

/**
 * Tokens for client title highlighting only — derived from the raw query string.
 * Keeps PGroonga operators / wildcards intact (splitting only on punctuation from
 * {@link SEARCH_KEYWORD_SPLIT_REGEX}), never runs jieba or other re-tokenization.
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

/**
 * Main torrent search resolver — discovery-only vs PGroonga keyword pipeline.
 *
 * Keyword mode composes `groonga_hits` (title and/or sidecar `search_text`), applies Gold/Silver/Bronze
 * scoring, buffers candidates, then paginates `filtered`. See `groongaHitsBody` for the tier math.
 */
export async function search(_: any, { queryInput }: any) {
  try {
    console.info("-".repeat(50));
    console.info("search params", queryInput);

    queryInput.keyword = String(queryInput.keyword ?? "").trim();

    const emptyKeywords = {
      __typename: "SearchResult" as const,
      keywords: [] as string[],
      torrents: [] as any[],
      total_count: 0,
      has_more: false,
    };

    const discoveryMode =
      queryInput.keyword.length < 2 &&
      hasActiveDiscoveryFiltersFromQueryInput(queryInput);

    if (queryInput.keyword.length < 2 && !discoveryMode) {
      return emptyKeywords;
    }

    const REGEX_HASH = /^[a-f0-9]{40}$/;

    if (queryInput.keyword.length === 40 && REGEX_HASH.test(queryInput.keyword)) {
      const torrent = await torrentByHash(_, { hash: queryInput.keyword });

      if (torrent) {
        return {
          __typename: "SearchResult" as const,
          keywords: [queryInput.keyword],
          torrents: [torrent],
          total_count: 1,
          has_more: false,
        };
      }

      return { ...emptyKeywords, keywords: [queryInput.keyword] };
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
      effectiveSortType === "bestMatch" && queryInput.keyword.length >= 2;

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
      const extracted = extractKeywords(queryInput.keyword);
      const fullStr = queryInput.keyword.replace(/"/g, "").trim();
      const fuzzyKeywordRows = extracted.filter(
        ({ keyword: k }) => k.trim().length >= 2,
      );
      if (fuzzyKeywordRows.length === 0) {
        return { ...emptyKeywords, keywords: [queryInput.keyword] };
      }
      keywordsPlain = buildSearchHighlightKeywords(queryInput.keyword);
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
    /** Monolith PGroonga pipeline `WITH` (includes `filtered`). */
    let bothEventHorizonWithClause = "";
    /** `COUNT(*)` for keyword search (no buffer/limit params). */
    let monolithCountSql = "";
    /**
     * `sqlParams.length` after `base` filters + PGroonga `&@~` (`keywordPh`), before buffer / page LIMIT.
     */
    let matchedHashesSqlParamCount: number | undefined;
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
      // Raw string for PGroonga `&@~` (Query Syntax: `*`, OR, `-`, etc.). No extra outer quotes — bound as a single text param.
      // Pipe is not boolean OR in PGroonga Query Syntax; normalize so alternation behaves as users expect from SQL tradition.
      const groongaQuery = queryInput.keyword.trim().replace(/\|/g, " OR ");
      const keywordPh = p(groongaQuery, "text");

      matchedHashesSqlParamCount = sqlParams.length;

      /** Cap rows entering `filtered` heavy math (PGroonga + laterals). */
      const bufferSize = Math.min(limitVal + offsetVal + 400, 410);
      const bufferPh = p(Math.max(1, bufferSize), "int");

      const monolithUsesBestMatchRank = effectiveSortType === "bestMatch";

      /**
       * `t.created_at` is `timestamptz`: use `NOW() - t.created_at` interval and `EXTRACT(EPOCH FROM …)`.
       * LN argument is parenthesized so `/ 86400 + 2` stays inside LN (not `LN(ABS) / 86400`).
       */
      const searchRankExpr = monolithUsesBestMatchRank
        ? `((tc.base_match_score::double precision * (1.0::double precision + (1.0::double precision / LN((ABS(EXTRACT(EPOCH FROM (NOW() - t.created_at)))::double precision / 86400.0 + 2.0::double precision)))) * (CASE WHEN ct_bm.content_type IN ('movie', 'tv_show') THEN 1.2::double precision ELSE 1.0::double precision END)) + (0.1::double precision * LN(GREATEST(t.max_seeders, 0)::double precision + (GREATEST((SELECT COALESCE(MAX(tts.leechers), 0) FROM torrents_torrent_sources tts WHERE tts.info_hash = t.info_hash), 0)::double precision * 0.5::double precision) + 1.0::double precision)))`
        : `0::double precision`;

      const monolithFilteredOrderBy = monolithUsesBestMatchRank
        ? `ORDER BY search_rank DESC NULLS LAST, t.size DESC`
        : `ORDER BY ${buildOrderBy(effectiveSortType, false, "t")}`;

      const filteredScoringJoinSql = monolithUsesBestMatchRank
        ? `LEFT JOIN LATERAL (
    SELECT tc2.content_type::text AS content_type
    FROM torrent_contents tc2
    WHERE tc2.info_hash = t.info_hash
    ORDER BY
      (SELECT COALESCE(MAX(tts.seeders), -1) FROM torrents_torrent_sources tts WHERE tts.info_hash = t.info_hash) DESC,
      tc2.updated_at DESC NULLS LAST
    LIMIT 1
  ) ct_bm ON true`
        : "";

      const groongaHitCandidatesSql =
        searchScope === "title"
          ? `SELECT info_hash FROM torrents WHERE name &@~ ${keywordPh}`
          : searchScope === "files"
            ? `SELECT info_hash FROM torrent_search_indexes WHERE search_text &@~ ${keywordPh}`
            : `SELECT info_hash FROM (
    SELECT info_hash FROM torrents WHERE name &@~ ${keywordPh}
    UNION
    SELECT info_hash FROM torrent_search_indexes WHERE search_text &@~ ${keywordPh}
  ) gh_union`;

      const filesScoreExpr =
        searchScope === "title"
          ? `0.0::double precision`
          : `COALESCE(fs.score, 0.0)::double precision`;

      const filesLateralSql =
        searchScope === "title"
          ? ""
          : `LEFT JOIN LATERAL (
    SELECT pgroonga_score(tsi.tableoid, tsi.ctid)::double precision AS score
    FROM torrent_search_indexes tsi
    WHERE tsi.info_hash = c.info_hash AND tsi.search_text &@~ ${keywordPh}
    LIMIT 1
  ) fs ON true`;

      /**
       * Sidecar `search_text` is one aggregated document per torrent; `pgroonga_score` there
       * reflects match strength across indexed file paths (not per-file rows).
       *
       * **Gold / Silver / Bronze tiering (`base_match_score`):**
       * - **Gold:** both title PGroonga hit and file-sidecar score → large floor + scaled title + raw files score.
       * - **Silver:** title-only → mid floor + scaled title (paths did not contribute).
       * - **Bronze:** files-only / title miss → raw files score only (paths carried the match).
       * Ordering within `scoring_buffer` then refines by score, seeders, and size before page LIMIT.
       */
      const groongaHitsBody = `
  SELECT
    c.info_hash,
    COALESCE(ts.score, 0.0)::double precision AS title_score,
    ${filesScoreExpr} AS files_score,
    (CASE
      WHEN COALESCE(ts.score, 0.0) > 0 AND ${filesScoreExpr} > 0 THEN
        20000.0::double precision + (COALESCE(ts.score, 0.0) * 100.0) + ${filesScoreExpr}
      WHEN COALESCE(ts.score, 0.0) > 0 THEN
        10000.0::double precision + (COALESCE(ts.score, 0.0) * 100.0)
      ELSE ${filesScoreExpr}
    END)::double precision AS base_match_score
  FROM (${groongaHitCandidatesSql}) c
  LEFT JOIN LATERAL (
    SELECT pgroonga_score(tn.tableoid, tn.ctid)::double precision AS score
    FROM torrents tn
    WHERE tn.info_hash = c.info_hash AND tn.name &@~ ${keywordPh}
    LIMIT 1
  ) ts ON true
  ${filesLateralSql}`;

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
  ${groongaHitsBody}
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
  ${groongaHitsBody}
),
scoring_buffer AS (
  SELECT
    b.info_hash,
    b.size,
    b.max_seeders,
    gh.title_score,
    gh.files_score,
    gh.base_match_score
  FROM base b
  INNER JOIN groonga_hits gh ON b.info_hash = gh.info_hash
  ORDER BY gh.base_match_score DESC, b.max_seeders DESC, b.size DESC
  LIMIT ${bufferPh}
),
filtered AS (
  SELECT
    t.info_hash,
    t.name,
    t.size,
    t.created_at,
    t.updated_at,
    t.files_count,
    t.file_stats,
    t.is_spam AS potential_spam,
    ${searchRankExpr} AS search_rank
  FROM scoring_buffer tc
  INNER JOIN torrents t ON t.info_hash = tc.info_hash
  ${filteredScoringJoinSql}
  ${monolithFilteredOrderBy}
  LIMIT ${p(limitVal, "int")}
  OFFSET ${p(offsetVal, "int")}
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
LEFT JOIN LATERAL (
  SELECT tc.content_type::text AS content_type
  FROM torrent_contents tc
  WHERE tc.info_hash = filtered.info_hash
  ORDER BY
    (SELECT COALESCE(MAX(tts.seeders), -1) FROM torrents_torrent_sources tts WHERE tts.info_hash = filtered.info_hash) DESC,
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
    (SELECT COALESCE(MAX(tts.seeders), -1) FROM torrents_torrent_sources tts WHERE tts.info_hash = filtered.info_hash) DESC,
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
) src ON true;
`;

    /** Snapshot before `LIMIT`/`OFFSET` placeholders on non-monolith main queries. */
    const countParamsForTotal =
      matchedHashesSqlParamCount !== undefined
        ? sqlParams.slice(0, matchedHashesSqlParamCount)
        : sqlParams.slice(0, searchInnerSqlParamCount ?? sqlParams.length);

    const sql =
      bothEventHorizonWithClause !== ""
        ? `WITH ${bothEventHorizonWithClause}${outerSelectFromFiltered}`
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
)${outerSelectFromFiltered}`;

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
