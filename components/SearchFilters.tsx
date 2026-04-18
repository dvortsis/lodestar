"use client";

/**
 * Lodestar search chrome — URL-driven facet state, progressive disclosure for power features.
 *
 * Primary controls stay sparse; “Advanced filters” gates an accordion where spam, exclude-words,
 * and payload-composition machinery live until the user explicitly opts in (see block below).
 */
import {
  Accordion,
  AccordionItem,
  Button,
  Card,
  CardBody,
  Input,
  Link,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectItem,
  Slider,
  Switch,
} from "@nextui-org/react";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Info,
  PieChart,
  Shield,
  Type,
} from "lucide-react";
import clsx from "clsx";
import {
  type ReadonlyURLSearchParams,
  useSearchParams,
} from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
} from "react";
import { useTranslations } from "next-intl";

import { ActiveFilters } from "@/components/ActiveFilters";
import { useAutoExpandFiles } from "@/components/search/AutoExpandFilesContext";
import { LodestarBrandIcon } from "@/components/LodestarBrandIcon";
import { SearchInput } from "@/components/SearchInput";
import { siteConfig } from "@/config/site";
import {
  CUSTOM_SIZE_UNITS,
  CUSTOM_TIME_UNITS,
  DEFAULT_EXCLUDE_WORDS_ENABLED,
  DEFAULT_HIDE_SPAM,
  SEARCH_PARAMS,
} from "@/config/constant";
import { useSearchNavigation } from "@/components/SearchNavigationProvider";
import { useSearchSession } from "@/hooks/useSearchSession";
import {
  hasActiveDiscoveryFilters,
  normalizeSearchScope,
  searchFacetFromSearchParams,
  type SearchFacetState,
} from "@/lib/searchUrl";
import type { FileCategory } from "@/lib/fileUtils";
import {
  COMPOSITION_CATEGORY_ICON,
  COMPOSITION_DISPLAY_ORDER,
} from "@/lib/compositionCategoryUi";
import {
  COMPOSITION_CATEGORIES,
  COMPOSITION_PARAM_KEYS,
  compositionFacetFromParams,
  hasActiveCompositionFilters,
  isCompositionRuleActive,
  parseCompositionParam,
  serializeCompositionRule,
  type CompositionFacetFields,
  type CompositionRule,
} from "@/lib/compositionFilter";

const DEFAULT_INCLUDE_PERCENT = 10;

type AdvancedDraftFilters = {
  hideSpam: boolean;
  excludeWordsEnabled: boolean;
  excludeWords: string;
  composition: CompositionFacetFields;
};

function readAdvancedDraftFromSearchParams(
  sp: ReadonlyURLSearchParams,
): AdvancedDraftFilters {
  return {
    hideSpam: sp.get("hideSpam") === "0" ? false : DEFAULT_HIDE_SPAM,
    excludeWordsEnabled:
      sp.get("excludeWordsEnabled") === "1"
        ? true
        : sp.get("excludeWordsEnabled") === "0"
          ? false
          : DEFAULT_EXCLUDE_WORDS_ENABLED,
    excludeWords: sp.get("excludeWords") || "",
    composition: compositionFacetFromParams((k) => sp.get(k) ?? ""),
  };
}

const SEGMENT_ICON_CLASS = "h-[14px] w-[14px] shrink-0";

function CompositionCategoryRow({
  category,
  composition,
  onCompositionChange,
  label,
  disabled,
}: {
  category: FileCategory;
  composition: CompositionFacetFields;
  onCompositionChange: (patch: Partial<CompositionFacetFields>) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const paramKey = COMPOSITION_PARAM_KEYS[category] as keyof CompositionFacetFields;
  const raw = String(composition[paramKey] ?? "");
  const rule = parseCompositionParam(raw);
  const tri: "ignore" | "exclude" | "include" = !isCompositionRuleActive(rule)
    ? "ignore"
    : rule.mode === "exclude"
      ? "exclude"
      : "include";

  const setRule = (next: CompositionRule) => {
    onCompositionChange({
      [paramKey]: serializeCompositionRule(next),
    });
  };

  const showThresholdSlider = rule.mode === "include";
  const sliderPercent =
    rule.mode === "include"
      ? Math.min(100, Math.max(1, rule.percent || DEFAULT_INCLUDE_PERCENT))
      : 1;

  const CategoryIcon = COMPOSITION_CATEGORY_ICON[category];

  const categoryIconClass = clsx(
    "h-[14px] w-[14px] shrink-0",
    tri === "include" &&
      "text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]",
    tri === "exclude" && "text-red-400",
    tri === "ignore" && "text-gray-500",
  );

  const segmentBase =
    "flex min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40";
  const segmentInactive =
    "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300";

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <CategoryIcon
            aria-hidden
            className={categoryIconClass}
            strokeWidth={2}
          />
          <span className="truncate text-xs font-semibold text-slate-600 dark:text-gray-300">
            {label}
          </span>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {showThresholdSlider ? (
            <div className="flex w-32 shrink-0 items-center gap-2 sm:w-40">
              <span className="sr-only">
                {t("Search.composition_threshold_label", { n: sliderPercent })}
              </span>
              <div className="min-w-0 flex-1">
                <Slider
                  aria-label={t("Search.composition_threshold_aria", {
                    category: label,
                  })}
                  className="w-full max-w-full"
                  isDisabled={disabled}
                  maxValue={100}
                  minValue={1}
                  size="sm"
                  step={1}
                  value={sliderPercent}
                  onChange={(v) => {
                    const n = Array.isArray(v) ? v[0] : v;
                    const pct = Math.min(100, Math.max(1, Math.round(Number(n))));
                    setRule({
                      mode: "include",
                      percent: pct,
                      metric: "count",
                    });
                  }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-default-600">
                {sliderPercent}%
              </span>
            </div>
          ) : null}
          <div
            className="inline-flex shrink-0 items-center rounded-full border border-gray-700/50 bg-gray-900/80 p-0.5"
            role="group"
            aria-label={t("Search.composition_segment_group_aria", {
              category: label,
            })}
          >
            <button
              type="button"
              disabled={disabled}
              aria-pressed={tri === "include"}
              className={clsx(
                segmentBase,
                tri === "include"
                  ? "bg-blue-500/15 text-blue-400 shadow-sm"
                  : segmentInactive,
              )}
              onClick={() => {
                setRule({
                  mode: "include",
                  percent:
                    rule.mode === "include" && rule.percent > 0
                      ? rule.percent
                      : DEFAULT_INCLUDE_PERCENT,
                  metric: "count",
                });
              }}
            >
              <CheckCircle2 className={SEGMENT_ICON_CLASS} aria-hidden />
              <span className="truncate">{t("Search.composition_segment_include")}</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={tri === "ignore"}
              className={clsx(
                segmentBase,
                tri === "ignore"
                  ? "bg-gray-700/50 text-gray-200 shadow-sm"
                  : segmentInactive,
              )}
              onClick={() => {
                onCompositionChange({ [paramKey]: "" });
              }}
            >
              <CircleDashed className={SEGMENT_ICON_CLASS} aria-hidden />
              <span className="truncate">{t("Search.composition_segment_ignore")}</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={tri === "exclude"}
              className={clsx(
                segmentBase,
                tri === "exclude"
                  ? "bg-red-500/15 text-red-400 shadow-sm"
                  : segmentInactive,
              )}
              onClick={() => {
                setRule({ mode: "exclude", percent: 0, metric: "count" });
              }}
            >
              <Ban className={SEGMENT_ICON_CLASS} aria-hidden />
              <span className="truncate">{t("Search.composition_segment_exclude")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SearchFilters() {
  useSearchSession();
  const { isPending, navigateSearch } = useSearchNavigation();
  const searchParams = useSearchParams();
  const t = useTranslations();

  const facet = searchFacetFromSearchParams(searchParams);

  const [draftCustomTime, setDraftCustomTime] = useState({
    from: facet.customTimeFrom,
    to: facet.customTimeTo,
    unit: facet.customTimeUnit,
  });
  const [draftCustomSize, setDraftCustomSize] = useState({
    min: facet.customSizeMin,
    max: facet.customSizeMax,
    unit: facet.customSizeUnit,
  });

  useEffect(() => {
    setDraftCustomTime({
      from: facet.customTimeFrom,
      to: facet.customTimeTo,
      unit: facet.customTimeUnit,
    });
  }, [facet.customTimeFrom, facet.customTimeTo, facet.customTimeUnit]);

  useEffect(() => {
    setDraftCustomSize({
      min: facet.customSizeMin,
      max: facet.customSizeMax,
      unit: facet.customSizeUnit,
    });
  }, [facet.customSizeMin, facet.customSizeMax, facet.customSizeUnit]);

  const advancedUrlSignature = useMemo(() => {
    const parts = [
      searchParams.get("hideSpam") ?? "",
      searchParams.get("excludeWordsEnabled") ?? "",
      searchParams.get("excludeWords") ?? "",
      ...COMPOSITION_CATEGORIES.map(
        (c) => searchParams.get(COMPOSITION_PARAM_KEYS[c]) ?? "",
      ),
    ];
    return parts.join("\u001f");
  }, [searchParams]);

  const [draftAdvancedFilters, setDraftAdvancedFilters] =
    useState<AdvancedDraftFilters>(() =>
      readAdvancedDraftFromSearchParams(searchParams),
    );

  useEffect(() => {
    setDraftAdvancedFilters(readAdvancedDraftFromSearchParams(searchParams));
  }, [advancedUrlSignature, searchParams]);

  const patchDraftComposition = useCallback(
    (patch: Partial<CompositionFacetFields>) => {
      setDraftAdvancedFilters((prev) => ({
        ...prev,
        composition: { ...prev.composition, ...patch },
      }));
    },
    [],
  );

  const pushFromPatch = (patch: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    if (patch.filterTime !== undefined && patch.filterTime !== "custom") {
      p.delete("customTimeFrom");
      p.delete("customTimeTo");
      p.delete("customTimeUnit");
    }
    if (patch.filterSize !== undefined && patch.filterSize !== "custom") {
      p.delete("customSizeMin");
      p.delete("customSizeMax");
      p.delete("customSizeUnit");
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === "") {
        p.delete(k);
      } else {
        p.set(k, v);
      }
    }
    p.delete("p");
    p.set("keyword", searchParams.get("keyword") ?? "");
    navigateSearch(`/search?${p.toString()}`);
  };

  const applyCustomTime = () => {
    pushFromPatch({
      customTimeFrom: draftCustomTime.from,
      customTimeTo: draftCustomTime.to,
      customTimeUnit: draftCustomTime.unit,
    });
  };

  const applyCustomSize = () => {
    pushFromPatch({
      customSizeMin: draftCustomSize.min,
      customSizeMax: draftCustomSize.max,
      customSizeUnit: draftCustomSize.unit,
    });
  };

  const applyAdvancedFilters = () => {
    const patch: Record<string, string> = {
      hideSpam: draftAdvancedFilters.hideSpam ? "1" : "0",
      excludeWordsEnabled: draftAdvancedFilters.excludeWordsEnabled
        ? "1"
        : "0",
      excludeWords: draftAdvancedFilters.excludeWords,
    };
    for (const cat of COMPOSITION_CATEGORIES) {
      const key = COMPOSITION_PARAM_KEYS[cat] as keyof CompositionFacetFields;
      const raw = draftAdvancedFilters.composition[key] ?? "";
      const rule = parseCompositionParam(raw);
      if (rule.mode === "include" && rule.percent <= 0) {
        patch[key] = serializeCompositionRule({
          mode: "include",
          percent: DEFAULT_INCLUDE_PERCENT,
          metric: "count",
        });
      } else {
        patch[key] = raw;
      }
    }
    pushFromPatch(patch);
  };

  const cancelAdvancedFilters = () => {
    setDraftAdvancedFilters(readAdvancedDraftFromSearchParams(searchParams));
  };

  const locked = isPending;

  const accordionIconActive =
    "text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]";
  const accordionIconIdle = "text-gray-500";

  const isSpamActive = useMemo(
    () => draftAdvancedFilters.hideSpam === true,
    [draftAdvancedFilters.hideSpam],
  );

  const isExcludeActive = useMemo(
    () =>
      draftAdvancedFilters.excludeWords.trim().length > 0 ||
      draftAdvancedFilters.excludeWordsEnabled === true,
    [
      draftAdvancedFilters.excludeWords,
      draftAdvancedFilters.excludeWordsEnabled,
    ],
  );

  const isCompositionActive = useMemo(
    () => hasActiveCompositionFilters(draftAdvancedFilters.composition),
    [draftAdvancedFilters.composition],
  );

  const { autoExpand, setAutoExpand } = useAutoExpandFiles();

  const showCustomTime = facet.filterTime === "custom";
  const showCustomSize = facet.filterSize === "custom";

  const rangeFieldClass =
    "h-9 min-h-9 bg-content2 border border-default-200 dark:border-default-100/60";

  /** Keeps the filter Select popover open while interacting with inline custom controls. */
  const stopFilterSelectClose: MouseEventHandler = (e) => {
    e.stopPropagation();
  };
  const stopFilterSelectClosePointer: PointerEventHandler = (e) => {
    e.stopPropagation();
  };

  /** Fixed width so Min / Max / Unit row and Apply stay aligned and unclipped. */
  const customRangeSelectPopoverClassNames = {
    popoverContent:
      "w-[min(100vw-1rem,20rem)] min-w-[min(100%,18rem)] max-w-[20rem] box-border p-1",
  } as const;

  const customTimeListboxBottom = showCustomTime ? (
    <div
      className="w-full min-w-0 border-t border-divider bg-default-100/70 dark:bg-default-50/40 px-2 py-2"
      role="presentation"
      onClick={stopFilterSelectClose}
      onPointerDown={stopFilterSelectClosePointer}
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        <div className="flex w-full min-w-0 items-center gap-2">
          <Input
            aria-label={t("Search.custom_from")}
            className="min-w-0 flex-1"
            classNames={{
              base: "min-w-0 flex-1",
              inputWrapper: `${rangeFieldClass} w-full min-w-0`,
              input: "text-xs",
            }}
            isDisabled={locked}
            min={0}
            placeholder={t("Search.custom_from")}
            size="sm"
            type="number"
            value={draftCustomTime.from}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomTime();
              }
            }}
            onValueChange={(v) =>
              setDraftCustomTime((prev) => ({ ...prev, from: v }))
            }
          />
          <Input
            aria-label={t("Search.custom_to")}
            className="min-w-0 flex-1"
            classNames={{
              base: "min-w-0 flex-1",
              inputWrapper: `${rangeFieldClass} w-full min-w-0`,
              input: "text-xs",
            }}
            isDisabled={locked}
            min={0}
            placeholder={t("Search.custom_to")}
            size="sm"
            type="number"
            value={draftCustomTime.to}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomTime();
              }
            }}
            onValueChange={(v) =>
              setDraftCustomTime((prev) => ({ ...prev, to: v }))
            }
          />
          <select
            aria-label={t("Search.custom_unit")}
            className={clsx(
              rangeFieldClass,
              "h-9 min-w-0 flex-[1.15] shrink-0 rounded-medium px-2 text-xs outline-none transition-colors",
              "hover:bg-default-200/80 dark:hover:bg-default-100/20",
            )}
            disabled={locked}
            value={draftCustomTime.unit}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onChange={(e) => {
              e.stopPropagation();
              const v = e.target.value;
              setDraftCustomTime((prev) => ({
                ...prev,
                unit:
                  v === "months" || v === "years" || v === "days" ? v : "days",
              }));
            }}
          >
            {CUSTOM_TIME_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`Search.custom_time_unit.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full pt-0.5">
          <Button
            className="h-8 min-h-8 w-full text-xs font-medium text-default-600"
            isDisabled={locked}
            size="sm"
            variant="light"
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onPress={applyCustomTime}
          >
            {t("Search.custom_range_apply")}
          </Button>
        </div>
      </div>
    </div>
  ) : undefined;

  const customSizeListboxBottom = showCustomSize ? (
    <div
      className="w-full min-w-0 border-t border-divider bg-default-100/70 dark:bg-default-50/40 px-2 py-2"
      role="presentation"
      onClick={stopFilterSelectClose}
      onPointerDown={stopFilterSelectClosePointer}
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        <div className="flex w-full min-w-0 items-center gap-2">
          <Input
            aria-label={t("Search.custom_size_min")}
            className="min-w-0 flex-1"
            classNames={{
              base: "min-w-0 flex-1",
              inputWrapper: `${rangeFieldClass} w-full min-w-0`,
              input: "text-xs",
            }}
            isDisabled={locked}
            min={0}
            placeholder={t("Search.custom_size_min")}
            size="sm"
            step="any"
            type="number"
            value={draftCustomSize.min}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomSize();
              }
            }}
            onValueChange={(v) =>
              setDraftCustomSize((prev) => ({ ...prev, min: v }))
            }
          />
          <Input
            aria-label={t("Search.custom_size_max")}
            className="min-w-0 flex-1"
            classNames={{
              base: "min-w-0 flex-1",
              inputWrapper: `${rangeFieldClass} w-full min-w-0`,
              input: "text-xs",
            }}
            isDisabled={locked}
            min={0}
            placeholder={t("Search.custom_size_max")}
            size="sm"
            step="any"
            type="number"
            value={draftCustomSize.max}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomSize();
              }
            }}
            onValueChange={(v) =>
              setDraftCustomSize((prev) => ({ ...prev, max: v }))
            }
          />
          <select
            aria-label={t("Search.custom_size_unit_label")}
            className={clsx(
              rangeFieldClass,
              "h-9 min-w-0 flex-[1.15] shrink-0 rounded-medium px-2 text-xs outline-none transition-colors",
              "hover:bg-default-200/80 dark:hover:bg-default-100/20",
            )}
            disabled={locked}
            value={draftCustomSize.unit}
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onChange={(e) => {
              e.stopPropagation();
              const v = e.target.value;
              setDraftCustomSize((prev) => ({
                ...prev,
                unit: v === "gb" || v === "mb" ? v : "mb",
              }));
            }}
          >
            {CUSTOM_SIZE_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`Search.custom_size_unit.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full pt-0.5">
          <Button
            className="h-8 min-h-8 w-full text-xs font-medium text-default-600"
            isDisabled={locked}
            size="sm"
            variant="light"
            onClick={stopFilterSelectClose}
            onPointerDown={stopFilterSelectClosePointer}
            onPress={applyCustomSize}
          >
            {t("Search.custom_range_apply")}
          </Button>
        </div>
      </div>
    </div>
  ) : undefined;

  const tg = (key: string) => t(`Search.search_tips_pgroonga.${key}`);

  const searchTipsContent = (
    <div className="max-h-[min(70vh,28rem)] max-w-md space-y-4 overflow-y-auto pr-1 text-xs text-default-700">
      <div className="flex items-center gap-2 border-b border-divider pb-2">
        <span aria-hidden className="text-base leading-none">
          🔍
        </span>
        <h3 className="text-sm font-semibold text-foreground">{tg("title")}</h3>
      </div>

      <p className="text-[11px] leading-relaxed text-default-600 border-b border-divider pb-3">
        {tg("syntax_intro")}
      </p>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
          {tg("section_syntax")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 marker:text-default-400">
          <li className="leading-relaxed">{tg("syntax_wildcards")}</li>
          <li className="leading-relaxed">{tg("syntax_logic")}</li>
          <li className="leading-relaxed">{tg("syntax_proximity")}</li>
          <li className="leading-relaxed">{tg("syntax_regex")}</li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
          {tg("section_basic")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 marker:text-default-400">
          <li className="leading-relaxed">{tg("basic_and")}</li>
          <li className="leading-relaxed">{tg("basic_or")}</li>
          <li className="leading-relaxed">{tg("basic_exclude")}</li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
          {tg("section_precision")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 marker:text-default-400">
          <li className="leading-relaxed">{tg("prec_phrase")}</li>
          <li className="leading-relaxed">{tg("prec_prefix")}</li>
          <li className="leading-relaxed">{tg("prec_single")}</li>
          <li className="leading-relaxed">{tg("prec_proximity")}</li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
          {tg("section_expert")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 marker:text-default-400">
          <li className="leading-relaxed">{tg("expert_group")}</li>
          <li className="leading-relaxed">{tg("expert_weight")}</li>
          <li className="leading-relaxed">{tg("expert_regex")}</li>
        </ul>
      </section>
    </div>
  );

  /** Aligns with SearchInput start: logo (w-12) + gap (gap-2 / md:gap-3) */
  const alignWithSearchInput = "pl-[3.5rem] md:pl-[3.75rem]";

  const lockedOverlay = locked ? "pointer-events-none opacity-60" : "";

  return (
    <>
      {/* Sticky: logo, search, info, toggles — sibling of scrollable filters (viewport sticky, no overflow wrapper) */}
      <div
        aria-busy={locked}
        className={clsx(
          "sticky top-0 z-50 w-full min-w-0 bg-content1 pt-4 pb-2",
          lockedOverlay,
        )}
      >
          {/* Row 1: Logo, search, pro-tips */}
          <div className="flex min-h-12 flex-row flex-wrap items-center gap-2 md:gap-3 w-full min-w-0">
            <Link
              className="shrink-0 flex h-12 w-12 items-center justify-center rounded-medium text-primary leading-none"
              href="/"
              title={siteConfig.name}
            >
              <LodestarBrandIcon className="h-9 w-9 object-contain md:h-10 md:w-10" />
            </Link>
            <div className="flex-1 min-w-[10rem] basis-[min(100%,18rem)]">
              <SearchInput defaultValue={facet.keyword} />
            </div>
            <div className="shrink-0 pl-2 md:pl-3">
              <Popover placement="bottom-start">
                <PopoverTrigger>
                  <Button
                    isIconOnly
                    aria-label={t("Search.search_tips_aria")}
                    className="h-12 w-12 min-w-12 text-default-500"
                    isDisabled={locked}
                    variant="light"
                  >
                    <Info className="w-[18px] h-[18px]" strokeWidth={2} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="max-w-md border border-default-200 bg-content2 p-4 dark:border-default-100/60">
                  {searchTipsContent}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/*
           * Progressive disclosure (Lodestar UX): only “Advanced filters” + “Auto-expand files”
           * sit in the always-visible strip. Regex-style excludes, spam policy, and composition
           * rules stay behind the Advanced switch + accordion so the default path stays quiet.
           */}
          {/* Row 4: Primary toggles — Advanced + Auto-expand only */}
          <div className="flex w-full min-h-10 min-w-0 flex-wrap items-center justify-center gap-6 pt-2">
            <Switch
              classNames={{
                base: "",
                label: "text-xs md:text-sm whitespace-nowrap",
              }}
              isDisabled={locked}
              isSelected={facet.advancedFiltersEnabled}
              size="sm"
              onValueChange={(v) => {
                if (v) {
                  pushFromPatch({ advancedFiltersEnabled: "1" });
                } else {
                  const patch: Record<string, string> = {
                    advancedFiltersEnabled: "0",
                  };
                  for (const cat of COMPOSITION_CATEGORIES) {
                    patch[COMPOSITION_PARAM_KEYS[cat]] = "";
                  }
                  pushFromPatch(patch);
                }
              }}
            >
              {t("Search.advanced_filters_switch")}
            </Switch>
            <Switch
              classNames={{
                base: "",
                label: "text-xs md:text-sm whitespace-nowrap",
              }}
              isDisabled={locked}
              isSelected={autoExpand}
              size="sm"
              onValueChange={setAutoExpand}
            >
              {t("Search.auto_expand_files")}
            </Switch>
          </div>
        </div>

      <div
        className={clsx(
          "flex flex-col gap-3 w-full min-w-0 max-w-full",
          lockedOverlay,
        )}
      >
        {/* Scrolls with page: active chips, filter grid, advanced composition */}
        {/* Row 2: Active filter chips — left-aligned with search input */}
      {hasActiveDiscoveryFilters(facet) && (
        <div className={`w-full min-w-0 ${alignWithSearchInput}`}>
          <ActiveFilters />
        </div>
      )}

      {/* Row 3: Filter dropdowns — centered, constrained width */}
      <div className="flex flex-col gap-2">
        <div className="mx-auto w-full min-w-0 max-w-full px-4 sm:px-6 lg:px-8">
          <div className="flex w-full flex-wrap justify-center gap-4">
            <div className="w-full min-w-0 basis-full sm:basis-[calc(50%-0.5rem)] sm:max-w-[calc(50%-0.5rem)] lg:basis-[calc(25%-0.75rem)] lg:max-w-[calc(25%-0.75rem)]">
              <Select
                classNames={{
                  label: "text-xs md:text-sm",
                  trigger: "h-10 min-h-10 md:h-12 md:min-h-12",
                  value: "text-xs md:text-sm",
                }}
                isDisabled={locked}
                label={t("Search.filterLabel.sortType")}
                selectedKeys={[facet.sortType]}
                size="sm"
                onChange={(e) => pushFromPatch({ sortType: e.target.value })}
              >
                {SEARCH_PARAMS.sortType.map((item) => (
                  <SelectItem key={item} className="text-xs md:text-sm">
                    {t(`Search.sortType.${item}`)}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="w-full min-w-0 basis-full sm:basis-[calc(50%-0.5rem)] sm:max-w-[calc(50%-0.5rem)] lg:basis-[calc(25%-0.75rem)] lg:max-w-[calc(25%-0.75rem)]">
              <Select
                classNames={{
                  label: "text-xs md:text-sm",
                  trigger: "h-10 min-h-10 md:h-12 md:min-h-12",
                  value: "text-xs md:text-sm",
                }}
                isDisabled={locked}
                label={t("Search.filterLabel.searchScope")}
                selectedKeys={[normalizeSearchScope(facet.searchScope)]}
                size="sm"
                onChange={(e) =>
                  pushFromPatch({
                    searchScope: normalizeSearchScope(e.target.value),
                  })
                }
              >
                {SEARCH_PARAMS.searchScope.map((item) => (
                  <SelectItem key={item} className="text-xs md:text-sm">
                    {t(`Search.searchScope.${item}`)}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="w-full min-w-0 basis-full sm:basis-[calc(50%-0.5rem)] sm:max-w-[calc(50%-0.5rem)] lg:basis-[calc(25%-0.75rem)] lg:max-w-[calc(25%-0.75rem)]">
              <Select
                classNames={{
                  label: "text-xs md:text-sm",
                  trigger: "h-10 min-h-10 md:h-12 md:min-h-12",
                  value: "text-xs md:text-sm",
                  ...(showCustomTime ? customRangeSelectPopoverClassNames : {}),
                }}
                isDisabled={locked}
                label={t("Search.filterLabel.filterTime")}
                listboxProps={
                  customTimeListboxBottom
                    ? {
                        className: "w-full min-w-0",
                        bottomContent: customTimeListboxBottom,
                      }
                    : undefined
                }
                selectedKeys={[facet.filterTime]}
                size="sm"
                onChange={(e) => pushFromPatch({ filterTime: e.target.value })}
              >
                {SEARCH_PARAMS.filterTime.map((item) => (
                  <SelectItem key={item} className="text-xs md:text-sm">
                    {t(`Search.filterTime.${item}`)}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="w-full min-w-0 basis-full sm:basis-[calc(50%-0.5rem)] sm:max-w-[calc(50%-0.5rem)] lg:basis-[calc(25%-0.75rem)] lg:max-w-[calc(25%-0.75rem)]">
              <Select
                classNames={{
                  label: "text-xs md:text-sm",
                  trigger: "h-10 min-h-10 md:h-12 md:min-h-12",
                  value: "text-xs md:text-sm",
                  ...(showCustomSize ? customRangeSelectPopoverClassNames : {}),
                }}
                isDisabled={locked}
                label={t("Search.filterLabel.filterSize")}
                listboxProps={
                  customSizeListboxBottom
                    ? {
                        className: "w-full min-w-0",
                        bottomContent: customSizeListboxBottom,
                      }
                    : undefined
                }
                selectedKeys={[facet.filterSize]}
                size="sm"
                onChange={(e) => pushFromPatch({ filterSize: e.target.value })}
              >
                {SEARCH_PARAMS.filterSize.map((item) => (
                  <SelectItem key={item} className="text-xs md:text-sm">
                    {t(`Search.filterSize.${item}`)}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/*
       * Advanced panel — progressive disclosure container.
       * Order: spam → exclude words → payload composition. Nothing here renders until
       * `advancedFiltersEnabled` is on, keeping cognitive load low for casual searches.
       */}
      {facet.advancedFiltersEnabled && (
        <div className={`w-full min-w-0 ${alignWithSearchInput}`}>
          <Card className="border border-default-200 bg-default-100/40 shadow-none dark:border-default-100/25 dark:bg-default-50/5">
            <CardBody className="gap-2 p-3 sm:p-4">
              <Accordion
                className="w-full gap-2 p-0"
                itemClasses={{
                  base: "rounded-lg border border-default-200 bg-content1 shadow-none dark:border-default-100/35",
                  content: "px-3 pb-3 pt-0",
                  indicator: "text-default-500",
                  title: "text-sm font-semibold text-default-800",
                  trigger:
                    "min-h-12 px-3 py-2.5 data-[hover=true]:bg-default-100/80 dark:data-[hover=true]:bg-default-50/10",
                }}
                selectionMode="multiple"
                variant="splitted"
              >
                <AccordionItem
                  key="spam"
                  aria-label={t("Search.advanced_accordion_spam_title")}
                  startContent={
                    <Shield
                      aria-hidden
                      className={
                        isSpamActive ? accordionIconActive : accordionIconIdle
                      }
                      size={18}
                    />
                  }
                  textValue={t("Search.advanced_accordion_spam_title")}
                  title={t("Search.advanced_accordion_spam_title")}
                >
                  <div className="flex flex-col gap-2 pt-0.5">
                    <Switch
                      classNames={{
                        base: "max-w-full",
                        label: "text-xs text-default-700",
                      }}
                      isDisabled={locked}
                      isSelected={draftAdvancedFilters.hideSpam}
                      size="sm"
                      onValueChange={(v) =>
                        setDraftAdvancedFilters((prev) => ({
                          ...prev,
                          hideSpam: v,
                        }))
                      }
                    >
                      {t("Search.hideSpam")}
                    </Switch>
                  </div>
                </AccordionItem>
                <AccordionItem
                  key="exclude"
                  aria-label={t("Search.advanced_accordion_exclude_title")}
                  startContent={
                    <Type
                      aria-hidden
                      className={
                        isExcludeActive
                          ? accordionIconActive
                          : accordionIconIdle
                      }
                      size={18}
                    />
                  }
                  textValue={t("Search.advanced_accordion_exclude_title")}
                  title={t("Search.advanced_accordion_exclude_title")}
                >
                  <div className="flex w-full flex-row items-center gap-3 pt-0.5">
                    <Switch
                      classNames={{
                        base: "max-w-fit shrink-0",
                        label: "text-xs text-default-700 whitespace-nowrap",
                      }}
                      isDisabled={locked}
                      isSelected={draftAdvancedFilters.excludeWordsEnabled}
                      size="sm"
                      onValueChange={(v) =>
                        setDraftAdvancedFilters((prev) => ({
                          ...prev,
                          excludeWordsEnabled: v,
                        }))
                      }
                    >
                      {t("Search.excludeWordsSwitch")}
                    </Switch>
                    {draftAdvancedFilters.excludeWordsEnabled ? (
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label={t("Search.excludeWordsLabel")}
                          classNames={{
                            base: "w-full",
                            inputWrapper:
                              "h-8 min-h-8 bg-default-100 py-0 data-[hover=true]:bg-default-200/80",
                            innerWrapper: "py-0",
                            input: "text-sm !py-1",
                          }}
                          isDisabled={locked}
                          placeholder={t("Search.excludeWordsPlaceholder")}
                          size="sm"
                          value={draftAdvancedFilters.excludeWords}
                          onValueChange={(v) =>
                            setDraftAdvancedFilters((prev) => ({
                              ...prev,
                              excludeWords: v,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </AccordionItem>
                <AccordionItem
                  key="composition"
                  aria-label={t("Search.advanced_accordion_composition_title")}
                  startContent={
                    <PieChart
                      aria-hidden
                      className={
                        isCompositionActive
                          ? accordionIconActive
                          : accordionIconIdle
                      }
                      size={18}
                    />
                  }
                  textValue={t("Search.advanced_accordion_composition_title")}
                  title={t("Search.advanced_accordion_composition_title")}
                >
                  <div className="flex flex-col gap-3 pt-0.5">
                    <div className="flex flex-col">
                      {COMPOSITION_DISPLAY_ORDER.map((cat) => (
                        <CompositionCategoryRow
                          key={cat}
                          category={cat}
                          composition={draftAdvancedFilters.composition}
                          disabled={locked}
                          label={t(`Search.file_cat_${cat}`)}
                          onCompositionChange={patchDraftComposition}
                        />
                      ))}
                    </div>
                  </div>
                </AccordionItem>
              </Accordion>
              <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-divider pt-3">
                <Button
                  isDisabled={locked}
                  size="sm"
                  variant="flat"
                  onPress={cancelAdvancedFilters}
                >
                  {t("Search.advanced_filters_cancel")}
                </Button>
                <Button
                  color="primary"
                  isLoading={locked}
                  size="sm"
                  onPress={applyAdvancedFilters}
                >
                  {t("Search.advanced_filters_apply")}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
      </div>
    </>
  );
}
