"use client";

/**
 * Lodestar per-torrent file tree — “zero-cost open”, bounded viewport, lazy tail.
 *
 * **Zero-cost preview:** When the parent search included `files_preview` and the user is not
 * filtering files in-tree, TanStack Query’s `initialData` seeds page 0 from that payload — opening
 * the accordion does not fire GraphQL until more rows are needed.
 *
 * **Lazy tail:** If `files_count` exceeds the preview, an `IntersectionObserver` on a bottom
 * sentinel calls `torrentFiles` to append pages. The scroll region is `max-h-64` so huge torrents
 * never blow the layout; virtualization keeps DOM rows bounded.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { Skeleton, Spinner } from "@nextui-org/react";
import { useTranslations } from "next-intl";

import { FilenameHighlight } from "@/components/FilenameHighlight";
import type { FileTreeNode } from "@/lib/fileUtils";
import { buildFileTree } from "@/lib/fileUtils";
import {
  fetchTorrentFilesPage,
  type TorrentFilesPagePayload,
} from "@/lib/torrentFilesGraphql";
import { TORRENT_FILES_PAGE_SIZE } from "@/config/constant";
import { formatByteSize } from "@/utils";

const ROW_HEIGHT = 28;

export type TorrentFilePreviewRow = {
  index: number;
  path: string;
  size: string;
  extension?: string;
};

function collectFolderPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") {
      out.push(n.fullPath, ...collectFolderPaths(n.children));
    }
  }
  return out;
}

function openFoldersAllExpanded(paths: string[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const p of paths) {
    next[p] = true;
  }
  return next;
}

type VisibleTreeNode = {
  id: string;
  node: FileTreeNode;
  depth: number;
};

function flattenVisibleNodes(
  nodes: FileTreeNode[],
  depth: number,
  openFolders: Record<string, boolean>,
  out: VisibleTreeNode[],
): void {
  for (const node of nodes) {
    out.push({ id: node.fullPath, node, depth });
    if (node.kind === "folder" && openFolders[node.fullPath]) {
      flattenVisibleNodes(node.children, depth + 1, openFolders, out);
    }
  }
}

function keywordsToFileSearchBoost(
  keywords: string | string[] | undefined,
): string {
  if (keywords == null) {
    return "";
  }
  if (Array.isArray(keywords)) {
    return keywords.map((k) => k.trim()).filter(Boolean).join(" ");
  }
  return keywords.trim();
}

function normalizePageFiles(
  rows: TorrentFilePreviewRow[],
): TorrentFilesPagePayload["files"] {
  return rows.map((f) => ({
    index: f.index,
    path: f.path,
    size: String(f.size),
    extension: f.extension ?? "",
  }));
}

export function TorrentFileTree({
  infoHash,
  filesCount,
  searchBoostKeywords,
  initialFiles,
}: {
  infoHash: string;
  /** Total files in the torrent (`torrents.files_count`), not path-match count. */
  filesCount: number;
  /** Search SQL preview (first 20 rows); hydrates page 0 without an extra round-trip */
  initialFiles?: TorrentFilePreviewRow[] | null;
  /** Main search keywords — ILIKE filter + highlight; skips hydration when non-empty */
  searchBoostKeywords?: string | string[];
}) {
  const t = useTranslations();
  const searchBoost = useMemo(
    () => keywordsToFileSearchBoost(searchBoostKeywords),
    [searchBoostKeywords],
  );

  // Hydrate React Query page 0 from search `files_preview` when file-in-tree filter is empty —
  // avoids a network round-trip on first paint of the expanded card (“zero-cost” open path).

  const initialInfiniteData = useMemo<
    InfiniteData<TorrentFilesPagePayload, number> | undefined
  >(() => {
    if (!initialFiles?.length || searchBoost.trim()) {
      return undefined;
    }
    const files = normalizePageFiles(initialFiles);
    return {
      pages: [{ files, total_count: Math.max(filesCount, files.length) }],
      pageParams: [0],
    };
  }, [initialFiles, searchBoost, filesCount]);

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ["torrentFiles", infoHash, searchBoost, TORRENT_FILES_PAGE_SIZE],
    queryFn: ({ pageParam }) =>
      fetchTorrentFilesPage({
        infoHash,
        search: searchBoost || undefined,
        limit: TORRENT_FILES_PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    initialData: initialInfiniteData,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.files.length, 0);
      if (loaded >= lastPage.total_count) {
        return undefined;
      }
      if (lastPage.files.length === 0) {
        return undefined;
      }
      return loaded;
    },
    enabled: filesCount > 0 && Boolean(infoHash),
  });

  const flatFiles = useMemo(
    () => data?.pages.flatMap((p) => p.files) ?? [],
    [data?.pages],
  );

  const tree = useMemo(() => {
    return buildFileTree(
      flatFiles.map((f) => ({
        path: f.path,
        size: f.size,
        index: f.index,
      })),
    );
  }, [flatFiles]);

  const allFolderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() =>
    openFoldersAllExpanded(allFolderPaths),
  );

  useEffect(() => {
    setOpenFolders(openFoldersAllExpanded(allFolderPaths));
  }, [allFolderPaths]);

  const flattenedFiles = useMemo(() => {
    const out: VisibleTreeNode[] = [];
    flattenVisibleNodes(tree, 0, openFolders, out);
    return out;
  }, [tree, openFolders]);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  const parentRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flattenedFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => flattenedFiles[index]?.id ?? index,
  });

  // When preview length < `files_count`, observe the list footer inside the scroll root and
  // page in the remainder via `torrentFiles` — no scroll-listener coupling; short lists still
  // intersect immediately if the sentinel is visible.

  useEffect(() => {
    const root = parentRef.current;
    const target = loadMoreSentinelRef.current;
    if (!root || !target || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (hit && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, flatFiles.length]);

  if (filesCount <= 0) {
    return null;
  }

  if (error) {
    return (
      <p className="text-xs text-danger">
        {error instanceof Error ? error.message : "Failed to load files"}
      </p>
    );
  }

  const showLoadingShell =
    (isLoading || isFetching) && flatFiles.length === 0;
  const showEmptyState =
    !isLoading && !isFetching && flatFiles.length === 0;

  if (showLoadingShell) {
    return (
      <div
        className="relative max-h-64 w-full min-w-0 space-y-2 overflow-hidden rounded-medium border border-default-200 bg-content1/40 p-2 dark:border-default-100/30"
        aria-busy
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-[10px] text-default-500">
          {isLoading ? <Spinner color="default" size="sm" /> : null}
          <span>Loading file tree…</span>
        </div>
        <Skeleton className="h-6 w-full rounded-md" />
        <Skeleton className="h-6 w-[95%] rounded-md" />
        <Skeleton className="h-6 w-[88%] rounded-md" />
      </div>
    );
  }

  if (showEmptyState) {
    return (
      <p className="text-xs text-default-500">No files available.</p>
    );
  }

  return (
    <div
      ref={parentRef}
      className="relative max-h-64 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-medium border border-default-200 bg-content1/40 p-2 dark:border-default-100/30"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const { node, depth, id } = flattenedFiles[virtualRow.index];
          const padRem = depth * 1.5;

          if (node.kind === "file") {
            return (
              <div
                key={id}
                className="flex items-center justify-between gap-2 py-0.5 text-xs text-default-700"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `${padRem}rem`,
                  boxSizing: "border-box",
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <File
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-default-400"
                  />
                  <span className="truncate font-mono">
                    <FilenameHighlight
                      searchTerm={searchBoost}
                      text={node.name}
                    />
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-default-500">
                  {formatByteSize(node.size)}
                </span>
              </div>
            );
          }

          const isOpen = openFolders[node.fullPath] === true;

          return (
            <div
              key={id}
              className="text-xs"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                paddingLeft: `${padRem}rem`,
                boxSizing: "border-box",
              }}
            >
              <button
                className="flex w-full min-w-0 items-center justify-between gap-2 rounded-small py-0.5 text-left text-default-800 hover:bg-default-100 dark:hover:bg-default-50/10"
                type="button"
                onClick={() => toggleFolder(node.fullPath)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <ChevronRight
                    aria-hidden
                    className={`h-3.5 w-3.5 shrink-0 text-default-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  {isOpen ? (
                    <FolderOpen
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-amber-600/90"
                    />
                  ) : (
                    <Folder
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-amber-600/90"
                    />
                  )}
                  <span className="truncate font-medium">
                    <FilenameHighlight
                      searchTerm={searchBoost}
                      text={node.name}
                    />
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {hasNextPage ? (
        <div
          ref={loadMoreSentinelRef}
          className="flex min-h-8 items-center justify-center gap-2 py-2 text-[10px] text-default-500"
        >
          {isFetchingNextPage ? (
            <>
              <Spinner color="default" size="sm" />
              <span>{t("Search.files_loading_more")}</span>
            </>
          ) : (
            <span>{t("Search.files_load_more_hint")}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
