import {
  DEFAULT_FILTER_SIZE,
  DEFAULT_FILTER_TIME,
  DEFAULT_FILTER_TIME_FIELD,
  DEFAULT_HIDE_SPAM,
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SORT_TYPE,
  SEARCH_PAGE_SIZE,
  SEARCH_PAGE_SIZE_OPTIONS,
  DEFAULT_CUSTOM_SIZE_MAX,
  DEFAULT_CUSTOM_SIZE_MIN,
  DEFAULT_CUSTOM_SIZE_UNIT,
  DEFAULT_CUSTOM_TIME_FROM,
  DEFAULT_CUSTOM_TIME_TO,
  DEFAULT_CUSTOM_TIME_UNIT,
  DEFAULT_EXCLUDE_WORDS_ENABLED,
  DEFAULT_ADVANCED_FILTERS_ENABLED,
} from "@/config/constant";
import {
  compositionFacetFromParams,
  compositionFacetToCategoryMap,
  hasActiveCompositionFilters,
  type CompositionFacetFields,
} from "@/lib/compositionFilter";
import type { SearchOptionComposition } from "@/types";

/** Preserves values like `"0"`; only missing or empty string uses the default. */
export function pickSearchParam(
  v: string | undefined,
  fallback: string,
): string {
  if (v === undefined || v === null) {
    return fallback;
  }
  const s = String(v);
  return s === "" ? fallback : s;
}

/** Bitmagnet time-axis for filters / sort: `discovered` → `torrents.created_at`, `added` → `updated_at`. */
export type FilterTimeFieldKey = "discovered" | "added";

/**
 * Maps URL/API `filterTimeField` to a valid key. Empty, unknown, or null values
 * fall back to {@link DEFAULT_FILTER_TIME_FIELD}. The legacy `original` axis maps to `discovered`.
 */
export function normalizeFilterTimeField(v: unknown): FilterTimeFieldKey {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "" || s === "created_at" || s === "original") {
    return "discovered";
  }
  if (s === "added" || s === "discovered") {
    return s;
  }
  const d = String(DEFAULT_FILTER_TIME_FIELD).trim().toLowerCase();
  if (d === "added" || d === "discovered") {
    return d;
  }
  return "discovered";
}

/** PGroonga source: torrent title vs sidecar unified text. */
export type SearchScopeKey = "title" | "files" | "both";

export function normalizeSearchScope(v: unknown): SearchScopeKey {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "title" || s === "files" || s === "both") {
    return s;
  }
  return DEFAULT_SEARCH_SCOPE as SearchScopeKey;
}

/** Serializable search facet (URL + session); omit `p` when persisting session */
export type SearchFacetState = {
  keyword: string;
  p: number;
  ps: number;
  sortType: string;
  /** `title` | `files` | `both` — see {@link normalizeSearchScope} */
  searchScope: string;
  filterTimeField: string;
  filterTime: string;
  filterSize: string;
  excludeWords: string;
  hideSpam: boolean;
  customTimeFrom: string;
  customTimeTo: string;
  customTimeUnit: string;
  customSizeMin: string;
  customSizeMax: string;
  customSizeUnit: string;
  /** When true, excludeWords are applied to the query */
  excludeWordsEnabled: boolean;
  /** UI: show payload composition accordion */
  advancedFiltersEnabled: boolean;
  /** `comp_*` mapped to categories; `image` comes from `comp_image` */
  composition: SearchOptionComposition;
} & CompositionFacetFields;

export function normalizePageSize(ps: number): number {
  const n = Number(ps);
  return (SEARCH_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : SEARCH_PAGE_SIZE;
}

export function hasActiveDiscoveryFilters(s: SearchFacetState): boolean {
  if (hasActiveCompositionFilters(s)) {
    return true;
  }
  if (s.filterTime !== DEFAULT_FILTER_TIME) {
    return true;
  }
  if (s.filterSize !== DEFAULT_FILTER_SIZE) {
    return true;
  }
  if (normalizeSearchScope(s.searchScope) !== DEFAULT_SEARCH_SCOPE) {
    return true;
  }
  if (s.excludeWordsEnabled && s.excludeWords.trim().length > 0) {
    return true;
  }
  if (!s.hideSpam) {
    return true;
  }
  if (s.sortType !== DEFAULT_SORT_TYPE) {
    return true;
  }
  return false;
}

/** Server-side: same rules as `hasActiveDiscoveryFilters` using loose API input */
export function hasActiveDiscoveryFiltersFromQueryInput(q: {
  filterTime?: string;
  filterSize?: string;
  searchScope?: string;
  sortType?: string;
  excludeWords?: string;
  excludeWordsEnabled?: boolean | string;
  hideSpam?: boolean | string;
}): boolean {
  const filterTime = String(q.filterTime ?? DEFAULT_FILTER_TIME);
  const filterSize = String(q.filterSize ?? DEFAULT_FILTER_SIZE);
  const searchScope = normalizeSearchScope(q.searchScope);
  const sortType = String(q.sortType ?? DEFAULT_SORT_TYPE);
  const exOn =
    q.excludeWordsEnabled === true ||
    q.excludeWordsEnabled === "1" ||
    String(q.excludeWordsEnabled) === "true";
  const excludeWords = String(q.excludeWords ?? "").trim();
  const hideOff =
    q.hideSpam === false ||
    q.hideSpam === "0" ||
    String(q.hideSpam).toLowerCase() === "false";

  if (filterTime !== DEFAULT_FILTER_TIME) {
    return true;
  }
  if (filterSize !== DEFAULT_FILTER_SIZE) {
    return true;
  }
  if (searchScope !== DEFAULT_SEARCH_SCOPE) {
    return true;
  }
  if (exOn && excludeWords.length > 0) {
    return true;
  }
  if (hideOff) {
    return true;
  }
  if (sortType !== DEFAULT_SORT_TYPE) {
    return true;
  }
  const comp = compositionFacetFromParams((k) => {
    const v = (q as Record<string, string | undefined>)[k];
    return v != null ? String(v) : "";
  });
  if (hasActiveCompositionFilters(comp)) {
    return true;
  }
  return false;
}

export function buildSearchParams(state: SearchFacetState, page?: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("keyword", state.keyword);
  params.set("p", String(page ?? state.p));
  params.set("ps", String(state.ps));

  if (state.sortType) {
    params.set("sortType", state.sortType);
  }
  params.set("searchScope", normalizeSearchScope(state.searchScope));
  if (state.filterTime) {
    params.set("filterTime", state.filterTime);
  }
  if (state.filterSize) {
    params.set("filterSize", state.filterSize);
  }
  params.set("excludeWordsEnabled", state.excludeWordsEnabled ? "1" : "0");
  if (state.excludeWords) {
    params.set("excludeWords", state.excludeWords);
  }
  params.set("hideSpam", state.hideSpam ? "1" : "0");
  params.set(
    "advancedFiltersEnabled",
    state.advancedFiltersEnabled ? "1" : "0",
  );

  if (state.filterTime === "custom") {
    params.set("customTimeFrom", state.customTimeFrom);
    params.set("customTimeTo", state.customTimeTo);
    params.set("customTimeUnit", state.customTimeUnit);
  }
  if (state.filterSize === "custom") {
    params.set("customSizeMin", state.customSizeMin);
    params.set("customSizeMax", state.customSizeMax);
    params.set("customSizeUnit", state.customSizeUnit);
  }

  for (const k of [
    "comp_video",
    "comp_audio",
    "comp_archive",
    "comp_app",
    "comp_document",
    "comp_image",
    "comp_other",
  ] as const) {
    const v = state[k];
    if (v != null && String(v).trim() !== "") {
      params.set(k, String(v).trim());
    }
  }

  return params;
}

export function searchFacetFromSearchParams(
  sp: URLSearchParams | Record<string, string | undefined>,
): SearchFacetState {
  const get = (k: string) =>
    typeof sp.get === "function" ? sp.get(k) ?? "" : (sp as Record<string, string | undefined>)[k] ?? "";

  const compositionFields = compositionFacetFromParams(get);

  return {
    keyword: get("keyword"),
    p: Math.max(1, Number(get("p")) || 1),
    ps: normalizePageSize(Number(get("ps")) || SEARCH_PAGE_SIZE),
    sortType: get("sortType") || DEFAULT_SORT_TYPE,
    searchScope: normalizeSearchScope(get("searchScope")),
    /** Time axis is fixed to `discovered` (UI for `added` was removed). */
    filterTimeField: "discovered",
    filterTime: get("filterTime") || DEFAULT_FILTER_TIME,
    filterSize: get("filterSize") || DEFAULT_FILTER_SIZE,
    excludeWords: get("excludeWords"),
    excludeWordsEnabled: (() => {
      const v = get("excludeWordsEnabled");
      if (v === "1") {
        return true;
      }
      if (v === "0") {
        return false;
      }
      return DEFAULT_EXCLUDE_WORDS_ENABLED;
    })(),
    hideSpam: get("hideSpam") === "0" ? false : DEFAULT_HIDE_SPAM,
    advancedFiltersEnabled: (() => {
      const v = get("advancedFiltersEnabled");
      if (v === "1") {
        return true;
      }
      if (v === "0") {
        return false;
      }
      return DEFAULT_ADVANCED_FILTERS_ENABLED;
    })(),
    customTimeFrom: pickSearchParam(get("customTimeFrom"), DEFAULT_CUSTOM_TIME_FROM),
    customTimeTo: pickSearchParam(get("customTimeTo"), DEFAULT_CUSTOM_TIME_TO),
    customTimeUnit: pickSearchParam(
      get("customTimeUnit"),
      DEFAULT_CUSTOM_TIME_UNIT,
    ),
    customSizeMin: pickSearchParam(get("customSizeMin"), DEFAULT_CUSTOM_SIZE_MIN),
    customSizeMax: pickSearchParam(get("customSizeMax"), DEFAULT_CUSTOM_SIZE_MAX),
    customSizeUnit: pickSearchParam(
      get("customSizeUnit"),
      DEFAULT_CUSTOM_SIZE_UNIT,
    ),
    ...compositionFields,
    composition: compositionFacetToCategoryMap(compositionFields),
  };
}
