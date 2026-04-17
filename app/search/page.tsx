import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SearchResultsList from "@/components/SearchResultsList";
import apiFetch from "@/utils/api";
import { SearchFilters } from "@/components/SearchFilters";
import { AutoExpandFilesProvider } from "@/components/search/AutoExpandFilesContext";
import {
  DEFAULT_SORT_TYPE,
  SEARCH_PAGE_SIZE,
  DEFAULT_FILTER_TIME,
  DEFAULT_FILTER_SIZE,
  DEFAULT_HIDE_SPAM,
  SEARCH_PAGE_MAX,
  DEFAULT_CUSTOM_TIME_FROM,
  DEFAULT_CUSTOM_TIME_TO,
  DEFAULT_CUSTOM_TIME_UNIT,
  DEFAULT_CUSTOM_SIZE_MIN,
  DEFAULT_CUSTOM_SIZE_MAX,
  DEFAULT_CUSTOM_SIZE_UNIT,
  DEFAULT_EXCLUDE_WORDS_ENABLED,
  DEFAULT_ADVANCED_FILTERS_ENABLED,
  DEFAULT_FILTER_TIME_FIELD,
} from "@/config/constant";
import {
  hasActiveDiscoveryFilters,
  normalizePageSize,
  normalizeSearchScope,
  pickSearchParam,
  type SearchFacetState,
} from "@/lib/searchUrl";
import {
  compositionFacetFromParams,
  compositionFacetToCategoryMap,
} from "@/lib/compositionFilter";

type SearchParams = {
  keyword?: string;
  p?: number;
  ps?: number;
  sortType?: string;
  searchScope?: string;
  filterTimeField?: string;
  filterTime?: string;
  filterSize?: string;
  excludeWords?: string;
  hideSpam?: string;
  excludeWordsEnabled?: string;
  customTimeFrom?: string;
  customTimeTo?: string;
  customTimeUnit?: string;
  customSizeMin?: string;
  customSizeMax?: string;
  customSizeUnit?: string;
  comp_video?: string;
  comp_audio?: string;
  comp_archive?: string;
  comp_app?: string;
  comp_document?: string;
  comp_image?: string;
  comp_other?: string;
  advancedFiltersEnabled?: string;
};

type SearchRequestType = {
  keyword: string;
  limit?: number;
  offset?: number;
  sortType?: string;
  searchScope?: string;
  filterTimeField?: string;
  filterTime?: string;
  filterSize?: string;
  excludeWords?: string;
  hideSpam?: boolean;
  excludeWordsEnabled?: boolean;
  customTimeFrom?: string;
  customTimeTo?: string;
  customTimeUnit?: string;
  customSizeMin?: string;
  customSizeMax?: string;
  customSizeUnit?: string;
  comp_video?: string;
  comp_audio?: string;
  comp_archive?: string;
  comp_app?: string;
  comp_document?: string;
  comp_image?: string;
  comp_other?: string;
};

/** Fields that change the matching set (and thus total_count) */
type CachedSearchFacet = {
  keyword: string;
  ps?: number;
  filterTime?: string;
  filterSize?: string;
  filterTimeField?: string;
  searchScope?: string;
  excludeWords?: string;
  hideSpam?: boolean;
  excludeWordsEnabled?: boolean;
  p?: number;
  customTimeFrom?: string;
  customTimeTo?: string;
  customTimeUnit?: string;
  customSizeMin?: string;
  customSizeMax?: string;
  customSizeUnit?: string;
  comp_video?: string;
  comp_audio?: string;
  comp_archive?: string;
  comp_app?: string;
  comp_document?: string;
  comp_image?: string;
  comp_other?: string;
};

let cachedSearchOption: CachedSearchFacet | null = null;
let totalCount = 0;

// Fetch data from the API based on search parameters
async function fetchData({
  keyword,
  limit = SEARCH_PAGE_SIZE,
  offset = 0,
  sortType,
  searchScope,
  filterTimeField,
  filterTime,
  filterSize,
  excludeWords,
  hideSpam,
  excludeWordsEnabled,
  customTimeFrom,
  customTimeTo,
  customTimeUnit,
  customSizeMin,
  customSizeMax,
  customSizeUnit,
  comp_video,
  comp_audio,
  comp_archive,
  comp_app,
  comp_document,
  comp_image,
  comp_other,
}: SearchRequestType): Promise<any> {
  const params = new URLSearchParams({
    keyword,
    limit: String(limit),
    offset: String(offset),
  });

  if (sortType) params.set("sortType", sortType);
  if (searchScope) params.set("searchScope", searchScope);
  params.set("filterTimeField", DEFAULT_FILTER_TIME_FIELD);
  if (filterTime) params.set("filterTime", filterTime);
  if (filterSize) params.set("filterSize", filterSize);
  if (filterTime === "custom") {
    params.set(
      "customTimeFrom",
      pickSearchParam(
        customTimeFrom != null ? String(customTimeFrom) : "",
        DEFAULT_CUSTOM_TIME_FROM,
      ),
    );
    params.set(
      "customTimeTo",
      pickSearchParam(
        customTimeTo != null ? String(customTimeTo) : "",
        DEFAULT_CUSTOM_TIME_TO,
      ),
    );
    params.set(
      "customTimeUnit",
      pickSearchParam(
        customTimeUnit != null ? String(customTimeUnit) : "",
        DEFAULT_CUSTOM_TIME_UNIT,
      ),
    );
  }
  if (filterSize === "custom") {
    params.set(
      "customSizeMin",
      pickSearchParam(
        customSizeMin != null ? String(customSizeMin) : "",
        DEFAULT_CUSTOM_SIZE_MIN,
      ),
    );
    params.set(
      "customSizeMax",
      pickSearchParam(
        customSizeMax != null ? String(customSizeMax) : "",
        DEFAULT_CUSTOM_SIZE_MAX,
      ),
    );
    params.set(
      "customSizeUnit",
      pickSearchParam(
        customSizeUnit != null ? String(customSizeUnit) : "",
        DEFAULT_CUSTOM_SIZE_UNIT,
      ),
    );
  }
  if (excludeWords) params.set("excludeWords", excludeWords);
  if (hideSpam !== undefined) {
    params.set("hideSpam", hideSpam ? "1" : "0");
  }
  if (excludeWordsEnabled !== undefined) {
    params.set("excludeWordsEnabled", excludeWordsEnabled ? "1" : "0");
  }
  const compPatch = {
    comp_video,
    comp_audio,
    comp_archive,
    comp_app,
    comp_document,
    comp_image,
    comp_other,
  };
  for (const [k, v] of Object.entries(compPatch)) {
    if (v) {
      params.set(k, v);
    }
  }

  // Check if it is a new search
  const isNewSearch =
    !cachedSearchOption ||
    keyword !== cachedSearchOption.keyword ||
    limit !== cachedSearchOption.ps ||
    filterTime !== cachedSearchOption.filterTime ||
    filterSize !== cachedSearchOption.filterSize ||
    filterTimeField !== cachedSearchOption.filterTimeField ||
    (searchScope || "") !== (cachedSearchOption.searchScope || "") ||
    (excludeWords || "") !== (cachedSearchOption.excludeWords || "") ||
    Boolean(hideSpam) !== Boolean(cachedSearchOption.hideSpam) ||
    Boolean(excludeWordsEnabled) !==
      Boolean(cachedSearchOption.excludeWordsEnabled) ||
    (filterTime === "custom" &&
      ((customTimeFrom || "") !== (cachedSearchOption.customTimeFrom || "") ||
        (customTimeTo || "") !== (cachedSearchOption.customTimeTo || "") ||
        (customTimeUnit || "") !== (cachedSearchOption.customTimeUnit || ""))) ||
    (filterSize === "custom" &&
      ((customSizeMin || "") !== (cachedSearchOption.customSizeMin || "") ||
        (customSizeMax || "") !== (cachedSearchOption.customSizeMax || "") ||
        (customSizeUnit || "") !== (cachedSearchOption.customSizeUnit || ""))) ||
    (comp_video || "") !== (cachedSearchOption.comp_video || "") ||
    (comp_audio || "") !== (cachedSearchOption.comp_audio || "") ||
    (comp_archive || "") !== (cachedSearchOption.comp_archive || "") ||
    (comp_app || "") !== (cachedSearchOption.comp_app || "") ||
    (comp_document || "") !== (cachedSearchOption.comp_document || "") ||
    (comp_image || "") !== (cachedSearchOption.comp_image || "") ||
    (comp_other || "") !== (cachedSearchOption.comp_other || "");

  if (isNewSearch) {
    cachedSearchOption = null; // Reset cachedSearchOption for new search
  } else {
    params.set("withTotalCount", "0");
  }

  try {
    const resp = await apiFetch(`/api/search?${params.toString()}`, {
      cache: "no-store",
    });

    if (isNewSearch) {
      totalCount = resp.data.total_count;
    }
    cachedSearchOption = {
      keyword,
      ps: limit,
      filterTimeField,
      searchScope,
      filterTime,
      filterSize,
      excludeWords,
      hideSpam,
      excludeWordsEnabled,
      customTimeFrom,
      customTimeTo,
      customTimeUnit,
      customSizeMin,
      customSizeMax,
      customSizeUnit,
      comp_video,
      comp_audio,
      comp_archive,
      comp_app,
      comp_document,
      comp_image,
      comp_other,
      p: cachedSearchOption?.p,
    };

    return resp;
  } catch (error: any) {
    console.error(error);

    throw error;
  }
}

// Generate metadata for the search page
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { keyword?: string };
}): Promise<Metadata> {
  const t = await getTranslations();
  const keyword = searchParams.keyword ?? "";

  return {
    title: t("Metadata.search.title", { keyword }),
  };
}

// Get search options from the search parameters
function getSearchOption(searchParams: SearchParams): SearchFacetState {
  const isNewSearch =
    !cachedSearchOption || searchParams.keyword !== cachedSearchOption.keyword;

  const get = (k: string) => {
    const v = searchParams[k as keyof SearchParams];
    return v != null ? String(v) : "";
  };

  const compositionFields = compositionFacetFromParams(get);

  return {
    keyword: searchParams.keyword ?? "",
    p: Math.min(isNewSearch ? 1 : searchParams.p || 1, SEARCH_PAGE_MAX),
    ps: normalizePageSize(Number(searchParams.ps) || SEARCH_PAGE_SIZE),
    sortType: searchParams.sortType || DEFAULT_SORT_TYPE,
    searchScope: normalizeSearchScope(searchParams.searchScope),
    filterTimeField: DEFAULT_FILTER_TIME_FIELD,
    filterTime: searchParams.filterTime || DEFAULT_FILTER_TIME,
    filterSize: searchParams.filterSize || DEFAULT_FILTER_SIZE,
    excludeWords: searchParams.excludeWords || "",
    hideSpam: searchParams.hideSpam === "0" ? false : DEFAULT_HIDE_SPAM,
    excludeWordsEnabled:
      searchParams.excludeWordsEnabled === "1"
        ? true
        : searchParams.excludeWordsEnabled === "0"
          ? false
          : DEFAULT_EXCLUDE_WORDS_ENABLED,
    advancedFiltersEnabled:
      searchParams.advancedFiltersEnabled === "1"
        ? true
        : searchParams.advancedFiltersEnabled === "0"
          ? false
          : DEFAULT_ADVANCED_FILTERS_ENABLED,
    customTimeFrom: pickSearchParam(
      searchParams.customTimeFrom != null
        ? String(searchParams.customTimeFrom)
        : "",
      DEFAULT_CUSTOM_TIME_FROM,
    ),
    customTimeTo: pickSearchParam(
      searchParams.customTimeTo != null
        ? String(searchParams.customTimeTo)
        : "",
      DEFAULT_CUSTOM_TIME_TO,
    ),
    customTimeUnit: pickSearchParam(
      searchParams.customTimeUnit != null
        ? String(searchParams.customTimeUnit)
        : "",
      DEFAULT_CUSTOM_TIME_UNIT,
    ),
    customSizeMin: pickSearchParam(
      searchParams.customSizeMin != null
        ? String(searchParams.customSizeMin)
        : "",
      DEFAULT_CUSTOM_SIZE_MIN,
    ),
    customSizeMax: pickSearchParam(
      searchParams.customSizeMax != null
        ? String(searchParams.customSizeMax)
        : "",
      DEFAULT_CUSTOM_SIZE_MAX,
    ),
    customSizeUnit: pickSearchParam(
      searchParams.customSizeUnit != null
        ? String(searchParams.customSizeUnit)
        : "",
      DEFAULT_CUSTOM_SIZE_UNIT,
    ),
    ...compositionFields,
    composition: compositionFacetToCategoryMap(compositionFields),
  };
}

// Component to render the search page
export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const searchOption = getSearchOption(searchParams);
  const kw = searchOption.keyword.trim();
  const allowFetch =
    kw.length >= 2 || hasActiveDiscoveryFilters(searchOption);

  const start_time = Date.now();
  const { data } = allowFetch
    ? await fetchData({
        keyword: kw,
        limit: searchOption.ps,
        offset: (searchOption.p - 1) * searchOption.ps,
        sortType: searchOption.sortType,
        searchScope: searchOption.searchScope,
        filterTimeField: searchOption.filterTimeField,
        filterTime: searchOption.filterTime,
        filterSize: searchOption.filterSize,
        excludeWords: searchOption.excludeWords,
        excludeWordsEnabled: searchOption.excludeWordsEnabled,
        hideSpam: searchOption.hideSpam,
        customTimeFrom: searchOption.customTimeFrom,
        customTimeTo: searchOption.customTimeTo,
        customTimeUnit: searchOption.customTimeUnit,
        customSizeMin: searchOption.customSizeMin,
        customSizeMax: searchOption.customSizeMax,
        customSizeUnit: searchOption.customSizeUnit,
        comp_video: searchOption.comp_video,
        comp_audio: searchOption.comp_audio,
        comp_archive: searchOption.comp_archive,
        comp_app: searchOption.comp_app,
        comp_document: searchOption.comp_document,
        comp_image: searchOption.comp_image,
        comp_other: searchOption.comp_other,
      })
    : { data: { keywords: [], torrents: [], total_count: 0 } };
  const cost_time = Date.now() - start_time;

  return (
    <AutoExpandFilesProvider>
      <div className="flex w-full max-w-full min-w-0 flex-col md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
        <SearchFilters />
        <SearchResultsList
          cost_time={cost_time}
          keywords={data.keywords ?? []}
          resultList={data.torrents ?? []}
          searchOption={searchOption}
          total_count={allowFetch ? totalCount : 0}
        />
      </div>
    </AutoExpandFilesProvider>
  );
}
