"use client";

import type { ReactNode } from "react";
import { Suspense, useMemo } from "react";
import {
  Link,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Button,
  Chip,
} from "@nextui-org/react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Disc,
  Gamepad2,
  Music,
  ShieldAlert,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { TorrentItemProps } from "@/types";
import { $env, hexToBase64, formatByteSize, setClipboard, Toast } from "@/utils";
import { TorrentFileTree } from "@/components/TorrentFileTree";
import { TorrentFilesBar } from "@/components/TorrentFilesBar";
import { TimeAgo } from "@/components/TimeAgo";
import { SEARCH_KEYWORD_SPLIT_REGEX } from "@/config/constant";
import {
  findPrefixWordMatch,
  isSimplePrefixWildcardToken,
} from "@/lib/searchUtils";
import { normalizeFilterTimeField } from "@/lib/searchUrl";
import { getFileTypeBreakdownFromFileStats } from "@/lib/fileUtils";
import { useHydration } from "@/hooks/useHydration";
import { extractVideoResolutions } from "@/lib/videoResolution";

const CONTENT_TYPE_MEDIA: Record<
  string,
  {
    Icon: LucideIcon;
    color: "secondary" | "primary" | "success" | "warning" | "default" | "danger";
    labelKey:
      | "Search.media_movie"
      | "Search.media_tv"
      | "Search.media_music"
      | "Search.media_game"
      | "Search.media_software"
      | "Search.media_xxx";
  }
> = {
  movie: { Icon: Clapperboard, color: "secondary", labelKey: "Search.media_movie" },
  tv_show: { Icon: Tv, color: "primary", labelKey: "Search.media_tv" },
  music: { Icon: Music, color: "success", labelKey: "Search.media_music" },
  game: { Icon: Gamepad2, color: "warning", labelKey: "Search.media_game" },
  software: { Icon: Disc, color: "default", labelKey: "Search.media_software" },
  xxx: { Icon: ShieldAlert, color: "danger", labelKey: "Search.media_xxx" },
};

function keepHighlightToken(k: string): boolean {
  const t = k.trim();
  return t.length >= 2 || isSimplePrefixWildcardToken(t);
}

function collectTitleKeywords(kw: string | string[]): string[] {
  try {
    if (Array.isArray(kw)) {
      return Array.from(
        new Set(
          kw
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter(keepHighlightToken),
        ),
      );
    }
    if (typeof kw !== "string") {
      return [];
    }
    const parts = [kw, ...kw.split(SEARCH_KEYWORD_SPLIT_REGEX)]
      .map((k) => k.trim())
      .filter(keepHighlightToken);
    return Array.from(new Set(parts));
  } catch {
    return [];
  }
}

function TitleHighlight({
  text,
  keywords,
}: {
  text: string;
  keywords: string | string[];
}) {
  const tokens = useMemo(() => collectTitleKeywords(keywords), [keywords]);
  if (!text || tokens.length === 0) {
    return <>{text}</>;
  }
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  let remaining = text;
  let nodeKey = 0;
  /** PGroonga tokens may include `*`; guard against zero-length matches stalling the loop. */
  const maxSteps = Math.max(remaining.length, 1) + sorted.length * 32 + 8;
  let steps = 0;
  while (remaining.length > 0) {
    if (++steps > maxSteps) {
      nodes.push(remaining);
      break;
    }
    let best: { idx: number; len: number } | null = null;
    for (const tok of sorted) {
      if (!tok) {
        continue;
      }
      let idx = -1;
      let len = 0;
      if (isSimplePrefixWildcardToken(tok)) {
        const stem = tok.slice(0, -1);
        if (!stem) {
          continue;
        }
        const found = findPrefixWordMatch(remaining, stem);
        if (found && found.len > 0) {
          idx = found.idx;
          len = found.len;
        }
      } else {
        idx = remaining.toLowerCase().indexOf(tok.toLowerCase());
        len = tok.length;
      }
      if (idx === -1 || len <= 0) {
        continue;
      }
      if (
        !best ||
        idx < best.idx ||
        (idx === best.idx && len > best.len)
      ) {
        best = { idx, len };
      }
    }
    if (!best || best.len <= 0) {
      nodes.push(remaining);
      break;
    }
    if (best.idx > 0) {
      nodes.push(remaining.slice(0, best.idx));
    }
    const matched = remaining.slice(best.idx, best.idx + best.len);
    nodes.push(
      <span
        key={`hl-${nodeKey++}`}
        className="text-primary font-bold bg-primary/20 rounded px-1"
      >
        {matched}
      </span>,
    );
    remaining = remaining.slice(best.idx + best.len);
  }
  return <>{nodes}</>;
}

function MediaTypeChip({
  Icon,
  label,
  color,
}: {
  Icon: LucideIcon;
  label: string;
  color: (typeof CONTENT_TYPE_MEDIA)[string]["color"];
}) {
  return (
    <Chip
      color={color}
      size="sm"
      startContent={<Icon aria-hidden className="w-[14px] h-[14px] shrink-0" />}
      variant="flat"
    >
      <span className="text-xs font-medium">{label}</span>
    </Chip>
  );
}

export type SearchResultAccordionProps = {
  item: TorrentItemProps;
  keywords: string | string[];
  filterTimeField?: "discovered" | "added";
};

function useSearchResultRowDerived({
  item,
  keywords,
  filterTimeField: filterTimeFieldProp = "discovered",
}: SearchResultAccordionProps) {
  const filterTimeField = normalizeFilterTimeField(filterTimeFieldProp);
  const titleShown = item.display_name ?? item.name;
  const data = {
    ...item,
    name: item.name,
    url: `/detail/${hexToBase64(item.hash)}`,
    files: item.files ?? [],
  };

  const t = useTranslations();

  const altCount = item.alternate_titles?.length ?? 0;
  const srcExtra = item.more_sources_count ?? 0;
  const showVariantsPopover =
    altCount > 0 ||
    srcExtra > 0 ||
    (item.sources && item.sources.length > 1);

  const hydrated = useHydration();

  const mediaKey = item.content_type?.toLowerCase().trim();
  const media = mediaKey ? CONTENT_TYPE_MEDIA[mediaKey] : undefined;
  const resolutions = extractVideoResolutions(item.name);

  const timeUnix =
    filterTimeField === "added" ? item.updated_at : item.created_at;
  const timeLineKey =
    filterTimeField === "added"
      ? "Search.date_line_added"
      : "Search.date_line_discovered";

  const typeBreakdown = useMemo(() => {
    if (!item.file_stats) {
      return [];
    }
    try {
      const raw =
        typeof item.file_stats === "string"
          ? JSON.parse(item.file_stats)
          : item.file_stats;
      return getFileTypeBreakdownFromFileStats(raw);
    } catch {
      return [];
    }
  }, [item.file_stats]);

  const peerStats = useMemo(() => {
    const src = item.sources;
    if (!src?.length) {
      return { seeders: null as number | null, leechers: null as number | null };
    }
    let maxS: number | null = null;
    let maxL: number | null = null;
    for (const s of src) {
      if (s.seeders != null) {
        maxS = maxS == null ? s.seeders : Math.max(maxS, s.seeders);
      }
      if (s.leechers != null) {
        maxL = maxL == null ? s.leechers : Math.max(maxL, s.leechers);
      }
    }
    return { seeders: maxS, leechers: maxL };
  }, [item.sources]);

  return {
    altCount,
    data,
    filterTimeField,
    hydrated,
    item,
    keywords,
    media,
    peerStats,
    resolutions,
    showVariantsPopover,
    srcExtra,
    t,
    timeLineKey,
    timeUnix,
    titleShown,
    typeBreakdown,
  };
}

/** Accordion trigger row (title + chips). */
export function SearchResultAccordionTitle(props: SearchResultAccordionProps) {
  const m = useSearchResultRowDerived(props);
  const { data, item, keywords, media, resolutions, showVariantsPopover, t } =
    m;
  const altCount = item.alternate_titles?.length ?? 0;
  const srcExtra = item.more_sources_count ?? 0;

  return (
    <div className="flex w-full flex-col gap-1.5 py-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1 break-all">
        <Link isExternal href={data.url} title={m.titleShown}>
          <h2 className="text-md leading-normal">
            <TitleHighlight keywords={keywords} text={m.titleShown} />
          </h2>
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          {media && (
            <MediaTypeChip
              color={media.color}
              Icon={media.Icon}
              label={t(media.labelKey)}
            />
          )}
          {resolutions.map((r) => (
            <Chip
              key={r}
              color="secondary"
              classNames={{ content: "font-bold text-xs" }}
              size="sm"
              variant="flat"
            >
              {r}
            </Chip>
          ))}
          {item.potential_spam && (
            <Chip color="warning" size="sm" variant="flat">
              {t("Search.potential_spam")}
            </Chip>
          )}
          {showVariantsPopover && (
            <Popover placement="bottom-start">
              <PopoverTrigger>
                <Button
                  className="h-7 min-w-0 px-2 text-xs"
                  size="sm"
                  variant="flat"
                >
                  {t("Search.variants_badge", {
                    count: srcExtra + altCount,
                  })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-md p-3">
                <div className="w-full space-y-3 text-xs">
                  {item.sources && item.sources.length > 0 && (
                    <div>
                      <div className="mb-1 font-semibold text-default-700">
                        {t("Search.sources_heading")}
                      </div>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {item.sources.map((s) => (
                          <li key={s.source}>
                            <span className="font-mono">{s.source}</span>
                            {s.seeders != null || s.leechers != null ? (
                              <span className="ml-1 text-default-500">
                                ({s.seeders ?? "—"} / {s.leechers ?? "—"})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {altCount > 0 && (
                    <div>
                      <div className="mb-1 font-semibold text-default-700">
                        {t("Search.alternate_titles_heading")}
                      </div>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {item.alternate_titles!.map((at) => (
                          <li key={at}>{at}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown in `AccordionItem` `subtitle` — visible when row is collapsed; clicks must not toggle accordion. */
export function SearchResultAccordionSubtitle(
  props: SearchResultAccordionProps,
) {
  const m = useSearchResultRowDerived(props);
  const { data, hydrated, item, peerStats, t, timeLineKey, timeUnix } = m;

  return (
    <div
      className="w-full min-w-0 border-t border-default-200/60 pt-2 dark:border-default-100/30"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1">
        <Link
          className="shrink-0 text-sm text-primary"
          href={data.magnet_uri}
          onClick={(e) => {
            if ($env.isMobile) {
              e.preventDefault();
              setClipboard(data.magnet_uri);
              Toast.success(t("Toast.copy_success"));
            }
          }}
        >
          <span className="mr-1 select-none dark:brightness-90">🧲</span>
          {t("Search.magnet")}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-x-2 gap-y-1 text-xs text-default-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:text-sm">
          <span>
            {t("Search.file_size")}
            {formatByteSize(data.size)}
          </span>
          <span>
            {t("Search.file_count")}
            {item.files_count}
          </span>
          {(peerStats.seeders != null || peerStats.leechers != null) && (
            <span className="inline-flex flex-wrap items-center gap-3">
              {peerStats.seeders != null && (
                <span
                  className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-500"
                  title={t("Search.seeders_hint")}
                >
                  <ArrowUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">{peerStats.seeders}</span>
                </span>
              )}
              {peerStats.leechers != null && (
                <span
                  className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-500"
                  title={t("Search.leechers_hint")}
                >
                  <ArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">{peerStats.leechers}</span>
                </span>
              )}
            </span>
          )}
          <Suspense key={hydrated ? "load" : "loading"}>
            <span className="inline-flex flex-wrap items-baseline gap-x-1 gap-y-0">
              <span className="text-default-600">{t(timeLineKey)}</span>
              <TimeAgo suppress={!hydrated} unix={timeUnix} />
            </span>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/**
 * Accordion panel — file tree only (metadata + magnet live in the accordion `subtitle`).
 *
 * Passes search `files_preview` into `TorrentFileTree` as `initialFiles` so the first paint of an
 * expanded row reuses data already paid for in the list query (Lodestar zero-cost open path).
 */
export function SearchResultAccordionBody(props: SearchResultAccordionProps) {
  const m = useSearchResultRowDerived(props);
  const { item, keywords, t, typeBreakdown } = m;

  return (
    <div className="w-full border-t border-default-200/50 bg-content1 px-4 pb-4 pt-3 dark:border-default-100/30">
      {item.files_count > 0 ? (
        <div className="space-y-3">
          {typeBreakdown.length > 0 && (
            <TorrentFilesBar
              breakdown={typeBreakdown}
              labelFor={(c) => t(`Search.file_cat_${c}`)}
            />
          )}
          <TorrentFileTree
            filesCount={item.files_count}
            infoHash={item.hash}
            initialFiles={item.files_preview ?? undefined}
            searchBoostKeywords={keywords}
          />
        </div>
      ) : (
        <p className="text-xs text-default-500">{t("Search.no_files_list")}</p>
      )}
    </div>
  );
}
