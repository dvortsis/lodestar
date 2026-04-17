export type TorrentFileInput = {
  path: string;
  size: number | string;
  index?: number;
};

export type FileTreeNode =
  | {
      kind: "file";
      name: string;
      fullPath: string;
      size: number;
    }
  | {
      kind: "folder";
      name: string;
      fullPath: string;
      children: FileTreeNode[];
    };

type MutableEntry =
  | { t: "file"; fullPath: string; size: number }
  | { t: "dir"; children: Map<string, MutableEntry> };

function toNum(size: number | string): number {
  const n = typeof size === "string" ? Number(size) : size;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds a nested folder/file tree from flat `torrent_files` paths.
 */
export function buildFileTree(files: TorrentFileInput[]): FileTreeNode[] {
  const root = new Map<string, MutableEntry>();

  for (const f of files) {
    const parts = f.path
      .replace(/\\/g, "/")
      .split("/")
      .filter((p) => p.length > 0);
    if (parts.length === 0) {
      continue;
    }
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.set(part, {
          t: "file",
          fullPath: f.path,
          size: toNum(f.size),
        });
      } else {
        let next = cur.get(part);
        if (!next || next.t === "file") {
          next = { t: "dir", children: new Map() };
          cur.set(part, next);
        }
        cur = next.children;
      }
    }
  }

  return convertMap(root, "");
}

function convertMap(map: Map<string, MutableEntry>, prefix: string): FileTreeNode[] {
  const out: FileTreeNode[] = [];
  for (const [name, entry] of Array.from(map.entries())) {
    const fullPath = prefix ? `${prefix}/${name}` : name;
    if (entry.t === "file") {
      out.push({
        kind: "file",
        name,
        fullPath: entry.fullPath,
        size: entry.size,
      });
    } else {
      const children = convertMap(entry.children, fullPath);
      children.sort(treeSort);
      out.push({
        kind: "folder",
        name,
        fullPath,
        children,
      });
    }
  }
  out.sort(treeSort);
  return out;
}

function treeSort(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export type FileCategory =
  | "video"
  | "audio"
  | "archive"
  | "app"
  | "document"
  | "image"
  | "other";

export type FileTypeBreakdown = {
  category: FileCategory;
  bytes: number;
  percent: number;
};

const VIDEO_EXT = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "mpg",
  "mpeg",
  "ts",
  "m2ts",
  "vob",
  "3gp",
  "asf",
  "divx",
]);

const AUDIO_EXT = new Set([
  "mp3",
  "flac",
  "wav",
  "aac",
  "ogg",
  "opus",
  "m4a",
  "wma",
  "ape",
  "alac",
  "aiff",
]);

const ARCHIVE_EXT = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "lzma",
  "cab",
  "tgz",
  "lz",
  "zst",
]);

const APP_EXT = new Set([
  "exe",
  "msi",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "apk",
  "bat",
  "cmd",
  "sh",
  "appimage",
  "msix",
  "jar",
]);

const DOC_EXT = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "rtf",
  "epub",
  "mobi",
  "csv",
  "odt",
  "ods",
]);

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "svg",
]);

/** Extensions treated as “other” for SQL composition (misc / subs not in other sets). */
const OTHER_EXT = new Set([
  "ico",
  "nfo",
  "sfv",
  "md5",
  "par2",
  "par",
  "cue",
  "log",
  "srt",
  "ass",
  "ssa",
  "sub",
  "idx",
  "ini",
  "cfg",
  "dat",
  "url",
  "lnk",
]);

function sortedExtList(s: Set<string>): string[] {
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

/**
 * Lowercase extensions per category for payload-composition SQL (`%.ext` ILIKE patterns).
 */
export const EXTENSIONS_BY_CATEGORY: Record<FileCategory, readonly string[]> = {
  video: sortedExtList(VIDEO_EXT),
  audio: sortedExtList(AUDIO_EXT),
  archive: [...sortedExtList(ARCHIVE_EXT), "tar.gz", "tar.bz2"].sort((a, b) =>
    a.localeCompare(b),
  ),
  app: sortedExtList(APP_EXT),
  document: sortedExtList(DOC_EXT),
  image: sortedExtList(IMAGE_EXT),
  other: sortedExtList(OTHER_EXT),
};

/** `%.ext` patterns for `tf.path ILIKE ANY(...)` — matches Bitmagnet path suffix rules. */
export function ilikePatternsForCategory(cat: FileCategory): string[] {
  return EXTENSIONS_BY_CATEGORY[cat].map((e) => `%.${e}`);
}

/**
 * Single-segment extensions for composition exclude (matches `torrent_files.extension`,
 * which is derived from the basename after the last dot — not `tar.gz`).
 */
export function extensionsForCompositionExclude(cat: FileCategory): string[] {
  return EXTENSIONS_BY_CATEGORY[cat].filter((e) => !e.includes("."));
}

function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

function categorize(ext: string): FileCategory {
  if (!ext) {
    return "other";
  }
  if (VIDEO_EXT.has(ext)) {
    return "video";
  }
  if (AUDIO_EXT.has(ext)) {
    return "audio";
  }
  if (ARCHIVE_EXT.has(ext)) {
    return "archive";
  }
  if (APP_EXT.has(ext)) {
    return "app";
  }
  if (DOC_EXT.has(ext)) {
    return "document";
  }
  if (IMAGE_EXT.has(ext)) {
    return "image";
  }
  return "other";
}

const EMPTY_BREAKDOWN: Record<FileCategory, number> = {
  video: 0,
  audio: 0,
  archive: 0,
  app: 0,
  document: 0,
  image: 0,
  other: 0,
};

/**
 * Groups files by coarse type category and returns byte counts and % of total file bytes.
 */
export function getFileTypeBreakdown(
  files: TorrentFileInput[],
): FileTypeBreakdown[] {
  const totals = { ...EMPTY_BREAKDOWN };
  let sum = 0;
  for (const f of files) {
    const sz = toNum(f.size);
    sum += sz;
    const cat = categorize(extOf(f.path));
    totals[cat] += sz;
  }
  if (sum <= 0) {
    return [];
  }
  const order: FileCategory[] = [
    "video",
    "audio",
    "archive",
    "app",
    "document",
    "image",
    "other",
  ];
  return order
    .map((category) => ({
      category,
      bytes: totals[category],
      percent: (totals[category] / sum) * 100,
    }))
    .filter((row) => row.bytes > 0);
}

type FileStatsBucket = { size?: number | string; count?: number | string };

/**
 * Builds the composition bar from `torrents.file_stats` JSONB (write-time rollups).
 * Does not scan `torrent_files` rows.
 */
export function getFileTypeBreakdownFromFileStats(
  fileStats: unknown,
): FileTypeBreakdown[] {
  if (!fileStats || typeof fileStats !== "object") {
    return [];
  }
  const order: FileCategory[] = [
    "video",
    "audio",
    "archive",
    "app",
    "document",
    "image",
    "other",
  ];
  let sum = 0;
  const bytes: Partial<Record<FileCategory, number>> = {};
  for (const cat of order) {
    const bucket = (fileStats as Record<string, FileStatsBucket | undefined>)[
      cat
    ];
    const sz = bucket?.size != null ? toNum(bucket.size as number | string) : 0;
    if (sz > 0) {
      bytes[cat] = sz;
      sum += sz;
    }
  }
  if (sum <= 0) {
    return [];
  }
  return order
    .map((category) => ({
      category,
      bytes: bytes[category] ?? 0,
      percent: ((bytes[category] ?? 0) / sum) * 100,
    }))
    .filter((row) => row.bytes > 0);
}
