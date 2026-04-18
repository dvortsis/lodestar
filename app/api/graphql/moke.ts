import mokeData from "@/moke";

export function search() {
  const s = mokeData.search as {
    keywords: string[];
    torrents: Array<Record<string, unknown>>;
    total_count: number;
    has_more: boolean;
  };
  return {
    __typename: "SearchResult" as const,
    keywords: s.keywords,
    total_count: s.total_count,
    has_more: s.has_more,
    torrents: (s.torrents ?? []).map((t) => {
      const files = Array.isArray(t.files) ? t.files : [];
      const files_preview = files.slice(0, 20).map((f: Record<string, unknown>) => ({
        __typename: "TorrentFile" as const,
        index: Number(f.index ?? 0),
        path: String(f.path ?? ""),
        size: String(f.size ?? "0"),
        extension: String(f.extension ?? ""),
      }));
      return {
        ...t,
        __typename: "Torrent" as const,
        files: [],
        files_preview,
        composition_counts:
          typeof t.composition_counts === "string"
            ? t.composition_counts
            : JSON.stringify({
                video: 2,
                audio: 1,
                image: 0,
                document: 0,
                archive: 1,
                app: 0,
                other: 0,
              }),
      };
    }),
  };
}

export function torrentByHash() {
  return mokeData.detail;
}

export function torrentFiles(
  _: unknown,
  args: {
    infoHash: string;
    search?: string | null;
    limit?: number | null;
    offset?: number | null;
  },
) {
  const files = (mokeData.detail as { files: Array<Record<string, unknown>> }).files ?? [];
  const rawLimit = args.limit ?? 200;
  const limit = Math.min(Math.max(Number(rawLimit) || 200, 1), 500);
  const offset = Math.max(Number(args.offset) || 0, 0);
  const searchRaw = (args.search ?? "").trim();
  const searchLower = searchRaw.toLowerCase();

  const list = files.map((f) => ({
    index: Number(f.index ?? 0),
    path: String(f.path ?? ""),
    size: String(f.size ?? "0"),
    extension: String(f.extension ?? ""),
  }));

  list.sort((a, b) => {
    if (searchLower) {
      const am = a.path.toLowerCase().includes(searchLower) ? 0 : 1;
      const bm = b.path.toLowerCase().includes(searchLower) ? 0 : 1;
      if (am !== bm) {
        return am - bm;
      }
    }
    return a.index - b.index;
  });

  const total_count = list.length;
  const page = list.slice(offset, offset + limit);

  return {
    __typename: "TorrentFilesPage" as const,
    files: page.map((f) => ({ ...f, __typename: "TorrentFile" as const })),
    total_count,
  };
}

export function statsInfo() {
  return mokeData.stats;
}
