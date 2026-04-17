"use client";

import { Chip } from "@nextui-org/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  DEFAULT_CUSTOM_SIZE_MAX,
  DEFAULT_CUSTOM_SIZE_MIN,
  DEFAULT_CUSTOM_SIZE_UNIT,
  DEFAULT_CUSTOM_TIME_FROM,
  DEFAULT_CUSTOM_TIME_TO,
  DEFAULT_CUSTOM_TIME_UNIT,
  DEFAULT_EXCLUDE_WORDS_ENABLED,
  DEFAULT_FILTER_SIZE,
  DEFAULT_FILTER_TIME,
  DEFAULT_HIDE_SPAM,
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SORT_TYPE,
} from "@/config/constant";
import {
  buildSearchParams,
  hasActiveDiscoveryFilters,
  normalizeSearchScope,
  searchFacetFromSearchParams,
  type SearchFacetState,
} from "@/lib/searchUrl";
import {
  compositionFacetToCategoryMap,
  EMPTY_COMPOSITION_FACET,
  hasActiveCompositionFilters,
} from "@/lib/compositionFilter";

type Badge = { id: string; label: string };

function facetForRemoval(
  current: SearchFacetState,
  patch: Partial<SearchFacetState>,
): SearchFacetState {
  const merged = { ...current, ...patch };
  return {
    ...merged,
    composition: compositionFacetToCategoryMap(merged),
  };
}

export function ActiveFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const facet = searchFacetFromSearchParams(searchParams);

  if (!hasActiveDiscoveryFilters(facet)) {
    return null;
  }

  const push = (next: SearchFacetState) => {
    const p = buildSearchParams(next, 1);
    router.push(`/search?${p.toString()}`);
  };

  const badges: Badge[] = [];

  if (facet.sortType !== DEFAULT_SORT_TYPE) {
    badges.push({
      id: "sortType",
      label: `${t("Search.filterLabel.sortType")}: ${t(`Search.sortType.${facet.sortType}`)}`,
    });
  }
  if (normalizeSearchScope(facet.searchScope) !== DEFAULT_SEARCH_SCOPE) {
    const sc = normalizeSearchScope(facet.searchScope);
    badges.push({
      id: "searchScope",
      label: `${t("Search.filterLabel.searchScope")}: ${t(`Search.searchScope.${sc}`)}`,
    });
  }
  if (facet.filterTime !== DEFAULT_FILTER_TIME) {
    let timeLabel = t(`Search.filterTime.${facet.filterTime}`);
    if (facet.filterTime === "custom") {
      timeLabel = `${timeLabel} (${facet.customTimeFrom}–${facet.customTimeTo} ${t(`Search.custom_time_unit.${facet.customTimeUnit as "days" | "months" | "years"}`)})`;
    }
    badges.push({
      id: "filterTime",
      label: `${t("Search.filterLabel.filterTime")}: ${timeLabel}`,
    });
  }
  if (facet.filterSize !== DEFAULT_FILTER_SIZE) {
    let sizeLabel = t(`Search.filterSize.${facet.filterSize}`);
    if (facet.filterSize === "custom") {
      sizeLabel = `${sizeLabel} (${facet.customSizeMin}–${facet.customSizeMax} ${facet.customSizeUnit.toUpperCase()})`;
    }
    badges.push({
      id: "filterSize",
      label: `${t("Search.filterLabel.filterSize")}: ${sizeLabel}`,
    });
  }
  if (!facet.hideSpam) {
    badges.push({
      id: "hideSpam",
      label: t("Search.active_filter_include_spam"),
    });
  }
  if (facet.excludeWordsEnabled && facet.excludeWords.trim()) {
    badges.push({
      id: "excludeWords",
      label: `${t("Search.excludeWordsLabel")}: ${facet.excludeWords.trim()}`,
    });
  }
  if (hasActiveCompositionFilters(facet)) {
    badges.push({
      id: "composition",
      label: t("Search.active_filter_composition"),
    });
  }

  const remove = (id: string) => {
    let next = facet;
    switch (id) {
      case "sortType":
        next = facetForRemoval(facet, { sortType: DEFAULT_SORT_TYPE });
        break;
      case "searchScope":
        next = facetForRemoval(facet, { searchScope: DEFAULT_SEARCH_SCOPE });
        break;
      case "filterTime":
        next = facetForRemoval(facet, {
          filterTime: DEFAULT_FILTER_TIME,
          customTimeFrom: DEFAULT_CUSTOM_TIME_FROM,
          customTimeTo: DEFAULT_CUSTOM_TIME_TO,
          customTimeUnit: DEFAULT_CUSTOM_TIME_UNIT,
        });
        break;
      case "filterSize":
        next = facetForRemoval(facet, {
          filterSize: DEFAULT_FILTER_SIZE,
          customSizeMin: DEFAULT_CUSTOM_SIZE_MIN,
          customSizeMax: DEFAULT_CUSTOM_SIZE_MAX,
          customSizeUnit: DEFAULT_CUSTOM_SIZE_UNIT,
        });
        break;
      case "hideSpam":
        next = facetForRemoval(facet, { hideSpam: DEFAULT_HIDE_SPAM });
        break;
      case "excludeWords":
        next = facetForRemoval(facet, {
          excludeWordsEnabled: DEFAULT_EXCLUDE_WORDS_ENABLED,
          excludeWords: "",
        });
        break;
      case "composition":
        next = facetForRemoval(facet, { ...EMPTY_COMPOSITION_FACET });
        break;
      default:
        return;
    }
    push(next);
  };

  if (badges.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 items-center min-h-[1.75rem] py-1"
      role="status"
      aria-label={t("Search.active_filters_region")}
    >
      {badges.map((b) => (
        <Chip
          key={b.id}
          classNames={{ content: "text-xs max-w-[min(100%,20rem)] truncate" }}
          size="sm"
          variant="flat"
          onClose={() => remove(b.id)}
        >
          {b.label}
        </Chip>
      ))}
    </div>
  );
}
