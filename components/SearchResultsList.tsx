"use client";

/**
 * Lodestar search results — accordion list + density-friendly metadata.
 *
 * Rows use a controlled NextUI Accordion (optional “auto-expand files” from context) so power
 * users can skim file trees without losing per-row collapse. Subtitle slots surface magnet and
 * stats even when collapsed; pagination and repo attribution sit outside the virtualized list.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Link,
  Pagination,
  Select,
  SelectItem,
  Skeleton,
} from "@nextui-org/react";
import type { Selection } from "@react-types/shared";
import { useTranslations } from "next-intl";
import { useIsSSR } from "@react-aria/ssr";

import {
  SearchResultAccordionBody,
  SearchResultAccordionSubtitle,
  SearchResultAccordionTitle,
} from "./SearchResultsItem";

import { useAutoExpandFiles } from "@/components/search/AutoExpandFilesContext";
import { SearchResultsListProps } from "@/types";
import { $env } from "@/utils";
import {
  SEARCH_PAGE_MAX,
  SEARCH_PAGE_SIZE_OPTIONS,
  SEARCH_SESSION_STORAGE_KEY,
} from "@/config/constant";
import {
  buildSearchParams,
  hasActiveDiscoveryFilters,
  normalizeFilterTimeField,
  type SearchFacetState,
} from "@/lib/searchUrl";
import { useSearchNavigation } from "@/components/SearchNavigationProvider";

function ResultsSkeletonBlock() {
  return (
    <div className="mb-6 w-full overflow-hidden rounded-xl border border-default-200 bg-content1 dark:border-default-100/40">
      <div className="space-y-3 bg-default-100/80 px-4 py-3 dark:bg-default-50/10">
        <Skeleton className="h-5 w-full max-w-xl rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="space-y-2 border-t border-default-200/60 px-4 py-3">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-[90%] rounded" />
      </div>
      <div className="flex flex-wrap gap-3 border-t border-default-200/60 px-4 py-2">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-4 w-36 rounded" />
      </div>
    </div>
  );
}

export default function SearchResultsList({
  resultList,
  keywords,
  cost_time = 0,
  total_count = 0,
  searchOption,
}: {
  resultList: SearchResultsListProps["torrents"];
  keywords: string[];
  cost_time: number;
  total_count: number;
  searchOption: SearchFacetState;
}) {
  const isSSR = useIsSSR();
  const t = useTranslations();
  const { isPending, navigateSearch } = useSearchNavigation();
  const { autoExpand } = useAutoExpandFiles();

  const [expandedKeys, setExpandedKeys] = useState<Selection>(new Set());

  const resultKeysSig = useMemo(
    () => resultList.map((i) => i.hash).join("\0"),
    [resultList],
  );

  useEffect(() => {
    if (autoExpand) {
      setExpandedKeys(new Set(resultList.map((i) => i.hash)));
    } else {
      setExpandedKeys(new Set());
    }
    // `resultKeysSig` tracks result identity; omit `resultList` from deps to avoid
    // collapsing open rows when the parent passes a new array reference for the same results.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resultList synced via resultKeysSig
  }, [autoExpand, resultKeysSig]);

  const handlePageChange = (page: number, state: SearchFacetState) => {
    const params = buildSearchParams(state, page);
    navigateSearch(`/search?${params.toString()}`);
  };

  const handlePageSizeChange = (ps: string) => {
    const next = Number(ps);
    if (!(SEARCH_PAGE_SIZE_OPTIONS as readonly number[]).includes(next)) {
      return;
    }
    const state: SearchFacetState = { ...searchOption, ps: next };
    const params = buildSearchParams(state, 1);
    navigateSearch(`/search?${params.toString()}`);
  };

  const handleReset = () => {
    try {
      sessionStorage.removeItem(SEARCH_SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    navigateSearch("/search");
  };

  const pagiConf = {
    page: searchOption.p,
    total: Math.min(Math.ceil(total_count / searchOption.ps), SEARCH_PAGE_MAX),
    siblinds: $env.isMobile ? 1 : 3,
  };

  const showPagination = !isSSR && pagiConf.total > 1;
  const showFooter = !isSSR && (total_count > 0 || searchOption.ps);

  const kwTrim = searchOption.keyword.trim();
  const canRunSearch =
    kwTrim.length >= 2 || hasActiveDiscoveryFilters(searchOption);
  const showKeywordHint = !isPending && !canRunSearch;
  const showNoHits =
    !isPending &&
    canRunSearch &&
    resultList.length === 0 &&
    total_count === 0;

  const filterTimeField = normalizeFilterTimeField(
    searchOption.filterTimeField,
  );

  // File-tree hydration for each row uses `files_preview` from the main search payload (zero
  // extra round-trip on expand); deeper file pages load via `TorrentFileTree` + GraphQL.

  return (
    <>
      <div className="mx-auto mb-4 flex w-full min-w-0 max-w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1 text-sm">
          {showKeywordHint ? (
            <p className="text-default-600">{t("Search.empty_keyword_hint")}</p>
          ) : (
            <div className="text-gray-500">
              {t("Search.results_found", { count: total_count })}
              {cost_time > 0 && (
                <span className="ml-1 text-xs">
                  {t("Search.cost_time", { cost_time: cost_time })}
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          className="shrink-0"
          color="default"
          isDisabled={isPending}
          size="sm"
          variant="light"
          onPress={handleReset}
        >
          {t("Search.reset_filters")}
        </Button>
      </div>

      {showNoHits && (
        <p className="mb-6 text-sm text-default-600">
          {t("Search.no_results_hint")}
        </p>
      )}

      {isPending ? (
        <>
          {Array.from({ length: 10 }, (_, i) => (
            <ResultsSkeletonBlock key={i} />
          ))}
        </>
      ) : (
        <Accordion
          className="w-full gap-3 p-0"
          itemClasses={{
            base: "mb-0 overflow-hidden rounded-xl border border-default-200 bg-content1 shadow-sm dark:border-default-100/40",
            content: "px-0 pb-0 pt-0 border-t-0 bg-content1",
            heading: "py-0",
            indicator: "text-default-600 shrink-0 self-start pt-1",
            title: "text-start pe-1",
            titleWrapper: "flex-col items-stretch gap-0 w-full min-w-0",
            subtitle: "w-full min-w-0 text-start",
            trigger:
              "py-2 px-3 rounded-none bg-content1 data-[hover=true]:bg-default-100/70 dark:data-[hover=true]:bg-default-50/10",
          }}
          selectedKeys={expandedKeys}
          selectionMode="multiple"
          variant="splitted"
          onSelectionChange={setExpandedKeys}
        >
          {resultList.map((item) => (
            <AccordionItem
              key={item.hash}
              aria-label={item.display_name ?? item.name}
              subtitle={
                <SearchResultAccordionSubtitle
                  filterTimeField={filterTimeField}
                  item={item}
                  keywords={keywords}
                />
              }
              textValue={(item.display_name ?? item.name).slice(0, 200)}
              title={
                <SearchResultAccordionTitle
                  filterTimeField={filterTimeField}
                  item={item}
                  keywords={keywords}
                />
              }
            >
              <SearchResultAccordionBody
                filterTimeField={filterTimeField}
                item={item}
                keywords={keywords}
              />
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {showFooter && (
        <div className="sticky bottom-0 z-40 mt-6 flex flex-wrap items-center justify-center gap-4 border-t border-divider bg-content1 py-4">
          {showPagination && (
            <Pagination
              key={`pagi_${Object.values(searchOption).join("_")}`}
              className="flex justify-center"
              classNames={{
                wrapper: "gap-x-2",
              }}
              initialPage={pagiConf.page}
              isDisabled={isPending}
              page={pagiConf.page}
              showControls={$env.isDesktop}
              siblings={pagiConf.siblinds}
              size={$env.isMobile ? "lg" : "md"}
              total={pagiConf.total}
              onChange={(page) => handlePageChange(page, searchOption)}
            />
          )}
          <Select
            aria-label={t("Search.items_per_page")}
            className="max-w-[11rem]"
            classNames={{ trigger: "min-h-10" }}
            isDisabled={isPending}
            selectedKeys={new Set([String(searchOption.ps)])}
            size="sm"
            variant="bordered"
            onChange={(e) => handlePageSizeChange(e.target.value)}
          >
            {SEARCH_PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={String(n)} textValue={String(n)}>
                {t("Search.items_per_page_option", { count: n })}
              </SelectItem>
            ))}
          </Select>
        </div>
      )}

      <p className="mb-4 mt-8 text-center text-sm text-default-500">
        <span>{t("Search.repo_line_prefix")}</span>
        <Link
          className="text-default-600 underline decoration-default-400 underline-offset-2 transition-colors hover:text-primary"
          href="https://github.com/dvortsis/lodestar"
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("Search.repo_link_text")}
        </Link>
      </p>
    </>
  );
}
