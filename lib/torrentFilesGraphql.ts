const TORRENT_FILES_QUERY = `
query TorrentFiles($infoHash: String!, $search: String, $limit: Int!, $offset: Int!) {
  torrentFiles(infoHash: $infoHash, search: $search, limit: $limit, offset: $offset) {
    files {
      index
      path
      size
      extension
    }
    total_count
  }
}
`;

export type TorrentFilesPagePayload = {
  files: {
    index: number;
    path: string;
    size: string;
    extension: string;
  }[];
  total_count: number;
};

export async function fetchTorrentFilesPage(args: {
  infoHash: string;
  search?: string;
  limit: number;
  offset: number;
}): Promise<TorrentFilesPagePayload> {
  const res = await fetch("/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: TORRENT_FILES_QUERY,
      variables: {
        infoHash: args.infoHash,
        search: args.search && args.search.trim() ? args.search.trim() : null,
        limit: args.limit,
        offset: args.offset,
      },
    }),
  });

  const json = (await res.json()) as {
    data?: { torrentFiles: TorrentFilesPagePayload };
    errors?: { message?: string }[];
  };

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "GraphQL error");
  }
  if (!json.data?.torrentFiles) {
    throw new Error("Invalid torrentFiles response");
  }

  return json.data.torrentFiles;
}
