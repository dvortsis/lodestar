import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next/dist";
import { gql } from "graphql-tag";
import { NextRequest } from "next/server";

/** Disable static caching for this route — search results must reflect live DB. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

// import { search, torrentByHash, statsInfo } from "./service";

const isDemoMode = process.env.DEMO_MODE === "true";
const { search, torrentByHash, statsInfo, torrentFiles } = isDemoMode
  ? require("./moke")
  : require("./service");

if (isDemoMode) {
  console.log("[Lodestar] This website is running in demo mode.");
}

// Define GraphQL Schema
const typeDefs = gql`
  type TorrentFile {
    index: Int
    path: String
    extension: String
    size: String
  }

  type TorrentSourceRow {
    source: String!
    seeders: Int
    leechers: Int
  }

  type Torrent {
    hash: String!
    name: String!
    display_name: String
    size: String!
    magnet_uri: String!
    single_file: Boolean!
    files_count: Int!
    file_stats: String
    composition_counts: String
    files_preview: [TorrentFile!]!
    files: [TorrentFile!]!
    created_at: Int!
    updated_at: Int!
    potential_spam: Boolean
    alternate_titles: [String!]
    sources: [TorrentSourceRow!]
    more_sources_count: Int
    content_type: String
  }

  input SearchQueryInput {
    keyword: String!
    offset: Int!
    limit: Int!
    sortType: String
    filterTime: String
    filterSize: String
    filterTimeField: String
    searchScope: String
    excludeWords: String
    excludeWordsEnabled: Boolean
    hideSpam: Boolean
    withTotalCount: Boolean
    customTimeFrom: String
    customTimeTo: String
    customTimeUnit: String
    customSizeMin: String
    customSizeMax: String
    customSizeUnit: String
    comp_video: String
    comp_audio: String
    comp_archive: String
    comp_app: String
    comp_document: String
    comp_image: String
    comp_other: String
  }

  type SearchResult {
    keywords: [String!]!
    torrents: [Torrent!]!
    total_count: Int!
    has_more: Boolean!
  }

  type statsInfoResult {
    size: String!
    total_count: Int!
    updated_at: Int!
    latest_torrent_hash: String
    latest_torrent: Torrent
  }

  type TorrentFilesPage {
    files: [TorrentFile!]!
    total_count: Int!
  }

  type Query {
    search(queryInput: SearchQueryInput!): SearchResult!
    torrentByHash(hash: String!): Torrent
    torrentFiles(
      infoHash: String!
      search: String
      limit: Int
      offset: Int
    ): TorrentFilesPage!
    statsInfo: statsInfoResult
  }
`;

// Create Apollo Server instance
const server = new ApolloServer({
  typeDefs,
  resolvers: {
    Query: {
      search,
      torrentByHash,
      torrentFiles,
      statsInfo,
    },
  },
});

// req has the type NextRequest
const handler = startServerAndCreateNextHandler<NextRequest>(server, {
  context: async (req) => ({ req }),
});

export { handler as GET, handler as POST };
