"use client";

import type { FileCategory, FileTypeBreakdown } from "@/lib/fileUtils";

const CATEGORY_STYLES: Record<
  FileCategory,
  { bar: string; dot: string }
> = {
  video: {
    bar: "bg-violet-500 dark:bg-violet-400",
    dot: "bg-violet-500",
  },
  audio: {
    bar: "bg-emerald-500 dark:bg-emerald-400",
    dot: "bg-emerald-500",
  },
  archive: {
    bar: "bg-orange-500 dark:bg-orange-400",
    dot: "bg-orange-500",
  },
  app: {
    bar: "bg-blue-500 dark:bg-blue-400",
    dot: "bg-blue-500",
  },
  document: {
    bar: "bg-amber-500 dark:bg-amber-400",
    dot: "bg-amber-500",
  },
  image: {
    bar: "bg-cyan-500 dark:bg-cyan-400",
    dot: "bg-cyan-500",
  },
  other: {
    bar: "bg-default-400 dark:bg-default-500",
    dot: "bg-default-400",
  },
};

type Props = {
  breakdown: FileTypeBreakdown[];
  labelFor: (c: FileCategory) => string;
};

export function TorrentFilesBar({ breakdown, labelFor }: Props) {
  if (breakdown.length === 0) {
    return null;
  }

  return (
    <div className="w-full space-y-2">
      <div
        aria-hidden
        className="flex h-3 w-full overflow-hidden rounded-full bg-default-100 dark:bg-default-50/20"
      >
        {breakdown.map((row) => (
          <div
            key={row.category}
            className={`h-full min-w-0 ${CATEGORY_STYLES[row.category].bar}`}
            style={{ width: `${Math.max(row.percent, 0)}%` }}
            title={`${labelFor(row.category)} ${row.percent.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-default-500">
        {breakdown.map((row) => (
          <span key={row.category} className="inline-flex items-center gap-1">
            <span
              className={`inline-block h-2 w-2 rounded-full ${CATEGORY_STYLES[row.category].dot}`}
            />
            <span>{labelFor(row.category)}</span>
            <span className="text-default-400 tabular-nums">
              {row.percent < 0.1 ? "<0.1" : row.percent.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
