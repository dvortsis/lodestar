// Define search parameters
export const SEARCH_PARAMS = {
  sortType: ["bestMatch", "size", "count", "date"],
  /** PGroonga axis: title = `torrents.name`, files/both = sidecar `search_text` */
  searchScope: ["title", "files", "both"],
  filterTimeField: ["discovered", "added"],
  filterTime: [
    "all",
    "gt-1day",
    "gt-7day",
    "gt-31day",
    "gt-365day",
    "custom",
  ],
  filterSize: [
    "all",
    "lt100mb",
    "gt100mb-lt500mb",
    "gt500mb-lt1gb",
    "gt1gb-lt5gb",
    "gt5gb",
    "custom",
  ],
} as const;

export const CUSTOM_TIME_UNITS = ["days", "months", "years"] as const;
export const CUSTOM_SIZE_UNITS = ["mb", "gb"] as const;

export const DEFAULT_CUSTOM_TIME_FROM = "2";
export const DEFAULT_CUSTOM_TIME_TO = "5";
export const DEFAULT_CUSTOM_TIME_UNIT = "days";
export const DEFAULT_CUSTOM_SIZE_MIN = "100";
export const DEFAULT_CUSTOM_SIZE_MAX = "1000";
export const DEFAULT_CUSTOM_SIZE_UNIT = "mb";

export const SEARCH_SESSION_STORAGE_KEY = "lodestar.search.v1";

/** `localStorage` key: when `"1"`, search result accordions expand all rows by default. */
export const AUTO_EXPAND_FILES_STORAGE_KEY = "lodestar.autoExpandFiles";

export type SearchFilterSelectKey = keyof typeof SEARCH_PARAMS;

export const SEARCH_FILTER_SELECT_KEYS: SearchFilterSelectKey[] = [
  "sortType",
  "filterTime",
  "filterSize",
];

// Tokenizer for search keywords (omit `*` — PGroonga suffix wildcards like `comput*` must stay one token)
export const SEARCH_KEYWORD_SPLIT_REGEX =
  /[.,!?;—()\[\]{}<>@#%^&~`"'|\-，。！？；“”‘’“”「」『』《》、【】……（）·　\s]/g;

/**
 * Optional SQL row cap when aggregating `torrent_files` into each torrent’s `files` JSON
 * (search + `torrentByHash`). `null` = no `LIMIT` — return every file row for that
 * `info_hash`. Does **not** affect main search pagination (`queryInput.limit` on torrents).
 */
export const TORRENT_FILES_PER_TORRENT_SQL_LIMIT: number | null = null;

/** Page size for `torrentFiles` infinite scroll (GraphQL + virtualized tree). */
export const TORRENT_FILES_PAGE_SIZE = 200;

// Using for Search page
export const SEARCH_DISPLAY_FILES_MAX = 10;
export const SEARCH_KEYWORD_LENGTH_MIN = 2;
export const SEARCH_KEYWORD_LENGTH_MAX = 100;
export const SEARCH_PAGE_SIZE = 10;
/** Allowed values for URL param `ps` / API `limit` */
export const SEARCH_PAGE_SIZE_OPTIONS = [10, 50, 100, 200] as const;
export const SEARCH_LIMIT_MAX = 200;
export const SEARCH_PAGE_MAX = 100;

export const DEFAULT_SORT_TYPE = "bestMatch";
export const DEFAULT_HIDE_SPAM = true;
export const DEFAULT_FILTER_TIME = "all";
export const DEFAULT_FILTER_SIZE = "all";
export const DEFAULT_FILTER_TIME_FIELD = "discovered";
/** Default unified search (name + paths in `search_text`). */
export const DEFAULT_SEARCH_SCOPE = "both";
export const DEFAULT_EXCLUDE_WORDS_ENABLED = false;
/** Show payload composition accordion + category controls */
export const DEFAULT_ADVANCED_FILTERS_ENABLED = false;

export const SEARCH_EXCLUDE_MAX_WORDS = 40;
export const SEARCH_EXCLUDE_MAX_LENGTH = 500;

// TODO: Support UI_HIDE_PADDING_FILE
export const UI_HIDE_PADDING_FILE = true; // https://www.bittorrent.org/beps/bep_0047.html

export const UI_BACKGROUND_ANIMATION = true;

/** Query keys preserved when submitting a new keyword from the search box */
export const SEARCH_URL_PRESERVE_KEYS = [
  "ps",
  "sortType",
  "filterTime",
  "filterSize",
  "searchScope",
  "excludeWords",
  "hideSpam",
  "customTimeFrom",
  "customTimeTo",
  "customTimeUnit",
  "customSizeMin",
  "customSizeMax",
  "customSizeUnit",
  "excludeWordsEnabled",
  "advancedFiltersEnabled",
  "comp_video",
  "comp_audio",
  "comp_archive",
  "comp_app",
  "comp_document",
  "comp_image",
  "comp_other",
] as const;

export const UI_BREAKPOINTS = {
  xs: "(max-width: 649px)",
  sm: "(min-width: 650px)",
  md: "(min-width: 960px)",
  lg: "(min-width: 1280px)",
  xl: "(min-width: 1400px)",
};
