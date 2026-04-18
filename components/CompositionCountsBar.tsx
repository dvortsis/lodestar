"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { FileCategory } from "@/lib/fileUtils";
import type { TorrentItemProps } from "@/types";
import {
  COMPOSITION_CATEGORY_ICON,
  COMPOSITION_DISPLAY_ORDER,
} from "@/lib/compositionCategoryUi";

/**
 * Tableau "Miller Stone" fills — static `bg-[#hex]` strings so Tailwind JIT retains them.
 */
const COMPOSITION_COUNTS_BG: Record<FileCategory, string> = {
  video: "bg-[#437889]",
  audio: "bg-[#F2C80F]",
  image: "bg-[#8FBC8F]",
  document: "bg-[#5F9EA0]",
  archive: "bg-[#FF9933]",
  app: "bg-[#E15759]",
  other: "bg-[#A9A9A9]",
};

/** Dark segments → light type + shadow; lighter segments → dark type. */
const COMPOSITION_COUNTS_TEXT: Record<FileCategory, string> = {
  video: "text-white drop-shadow-md",
  audio: "text-slate-900",
  image: "text-slate-900",
  document: "text-white drop-shadow-md",
  archive: "text-slate-900",
  app: "text-white drop-shadow-md",
  other: "text-slate-900",
};

function parseCompositionCounts(
  raw: string | null | undefined,
): Record<string, number> {
  if (raw == null || raw === "") {
    return {};
  }
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") {
      return {};
    }
    const out: Record<string, number> = {};
    for (const k of COMPOSITION_DISPLAY_ORDER) {
      const n = Number((o as Record<string, unknown>)[k]);
      out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Stacked horizontal bar of per-category file counts (`composition_counts`).
 */
export function CompositionCountsBar({ item }: { item: TorrentItemProps }) {
  const t = useTranslations();

  const counts = useMemo(
    () => parseCompositionCounts(item.composition_counts ?? undefined),
    [item.composition_counts],
  );

  const total = useMemo(
    () =>
      COMPOSITION_DISPLAY_ORDER.reduce((sum, c) => sum + (counts[c] ?? 0), 0),
    [counts],
  );

  if (total <= 0) {
    return null;
  }

  return (
    <div className="mt-2 flex h-7 min-h-[28px] w-full overflow-hidden rounded-md bg-default-100/90 ring-1 ring-default-200/60 dark:bg-default-50/20 dark:ring-default-100/20">
      {COMPOSITION_DISPLAY_ORDER.map((cat) => {
        const n = counts[cat] ?? 0;
        if (n <= 0) {
          return null;
        }
        const pct = (n / total) * 100;
        const label = t(`Search.file_cat_${cat}`);
        const title = `${label}: ${n.toLocaleString()}`;
        const Icon = COMPOSITION_CATEGORY_ICON[cat];
        const showLabel = pct > 8;
        const pctLabel =
          pct < 0.1 ? "<0.1%" : `${pct >= 99.5 ? Math.round(pct) : pct.toFixed(0)}%`;

        return (
          <div
            key={cat}
            className={clsx(
              "flex min-w-0 shrink-0 items-center justify-center overflow-hidden",
              COMPOSITION_COUNTS_BG[cat],
            )}
            style={{ width: `${pct}%` }}
            title={title}
          >
            {showLabel ? (
              <div
                className={clsx(
                  "flex max-w-full items-center justify-center gap-1 overflow-hidden px-0.5 text-[10px] font-medium leading-none",
                  COMPOSITION_COUNTS_TEXT[cat],
                )}
              >
                <Icon
                  aria-hidden
                  className="h-[14px] w-[14px] shrink-0 opacity-95"
                  strokeWidth={2.25}
                />
                <span className="min-w-0 truncate tabular-nums">{pctLabel}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
