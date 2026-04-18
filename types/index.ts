import { SVGProps } from "react";

import type { FileCategory } from "@/lib/fileUtils";

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/** Seven composition facet params validated in `app/api/search/route.ts` and passed to the search service. */
export type SearchCompositionQueryParams = {
  comp_video?: string;
  comp_audio?: string;
  comp_archive?: string;
  comp_app?: string;
  comp_document?: string;
  comp_image?: string;
  comp_other?: string;
};

/** Category-keyed composition rules; `image` is populated from `comp_image`. */
export type SearchOptionComposition = Partial<Record<FileCategory, string>>;

/** Main object passed to the search API / service (flat `comp_*` + nested `composition`). */
export type SearchOption = SearchCompositionQueryParams & {
  keyword: string;
  composition: SearchOptionComposition;
};

export type SearchResultsListProps = {
  torrents: TorrentItemProps[];
  total_count: number;
  has_more: boolean;
};

export type TorrentSourceRow = {
  source: string;
  seeders: number | null;
  leechers: number | null;
};

export type TorrentItemProps = {
  hash: string;
  name: string;
  /** Preferred display title (metadata / best source); falls back to `name` */
  display_name?: string;
  size: number;
  magnet_uri: string;
  single_file: boolean;
  files_count: number;
  /** JSON string of `torrents.file_stats` (composition rollups from search/detail API) */
  file_stats?: string | null;
  /** JSON string of per-category file counts from `torrent_compositions` (search/detail) */
  composition_counts?: string | null;
  /** First 20 files from search SQL (hydrate file tree without waiting for torrentFiles page 0) */
  files_preview?: {
    index: number;
    path: string;
    size: string;
    extension: string;
  }[];
  /** Per-file rows; omitted from search payload (use `torrentFiles` + file tree when expanded) */
  files?: {
    index: number;
    path: string;
    size: number;
    extension: string;
  }[];
  created_at: number;
  updated_at: number;
  potential_spam?: boolean;
  alternate_titles?: string[];
  sources?: TorrentSourceRow[];
  more_sources_count?: number;
  /** Bitmagnet torrent_contents.content_type (e.g. movie, tv_show) */
  content_type?: string;
};
