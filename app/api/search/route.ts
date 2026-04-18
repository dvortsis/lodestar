import { NextResponse } from "next/server";
import { gql } from "@apollo/client";
import { z } from "zod";

import client from "@/lib/apolloClient.server";
import {
  SEARCH_PARAMS,
  SEARCH_KEYWORD_LENGTH_MAX,
  SEARCH_PAGE_SIZE,
  SEARCH_LIMIT_MAX,
  DEFAULT_SORT_TYPE,
  DEFAULT_FILTER_TIME,
  DEFAULT_FILTER_SIZE,
  DEFAULT_FILTER_TIME_FIELD,
  DEFAULT_HIDE_SPAM,
  SEARCH_EXCLUDE_MAX_LENGTH,
  DEFAULT_CUSTOM_TIME_FROM,
  DEFAULT_CUSTOM_TIME_TO,
  DEFAULT_CUSTOM_TIME_UNIT,
  DEFAULT_CUSTOM_SIZE_MIN,
  DEFAULT_CUSTOM_SIZE_MAX,
  DEFAULT_CUSTOM_SIZE_UNIT,
  DEFAULT_EXCLUDE_WORDS_ENABLED,
} from "@/config/constant";
import {
  normalizeFilterTimeField,
  normalizePageSize,
  normalizeSearchScope,
} from "@/lib/searchUrl";

// GraphQL query to search for torrents
const SEARCH = gql`
  query Search($queryInput: SearchQueryInput!) {
    search(queryInput: $queryInput) {
      keywords
      torrents {
        hash
        name
        display_name
        size
        magnet_uri
        single_file
        files_count
        file_stats
        composition_counts
        files_preview {
          index
          path
          size
          extension
        }
        created_at
        updated_at
        potential_spam
        alternate_titles
        sources {
          source
          seeders
          leechers
        }
        more_sources_count
      }
      total_count
      has_more
    }
  }
`;

// Define the schema for the request parameters using Zod
const schema = z.object({
  keyword: z.string().max(SEARCH_KEYWORD_LENGTH_MAX).default(""),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce
    .number()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .default(SEARCH_PAGE_SIZE),
  sortType: z.preprocess(
    (v) => {
      if (v === "default") return "bestMatch";
      if (v === "originalDate") return "date";
      return v;
    },
    z.enum(SEARCH_PARAMS.sortType).default(DEFAULT_SORT_TYPE),
  ),
  filterTime: z.enum(SEARCH_PARAMS.filterTime).default(DEFAULT_FILTER_TIME),
  filterSize: z.enum(SEARCH_PARAMS.filterSize).default(DEFAULT_FILTER_SIZE),
  filterTimeField: z.preprocess(
    (v) => normalizeFilterTimeField(v),
    z.enum(SEARCH_PARAMS.filterTimeField),
  ),
  searchScope: z.preprocess(
    (v) => normalizeSearchScope(v),
    z.enum(SEARCH_PARAMS.searchScope),
  ),
  excludeWords: z
    .string()
    .max(SEARCH_EXCLUDE_MAX_LENGTH)
    .default(""),
  excludeWordsEnabled: z
    .enum(["0", "1"])
    .transform((value) => value === "1")
    .default(DEFAULT_EXCLUDE_WORDS_ENABLED ? "1" : "0"),
  hideSpam: z
    .enum(["0", "1"])
    .transform((value) => value === "1")
    .default(DEFAULT_HIDE_SPAM ? "1" : "0"),
  withTotalCount: z
    .enum(["0", "1"])
    .transform((value) => value === "1")
    .default("1"),
  customTimeFrom: z.string().default(DEFAULT_CUSTOM_TIME_FROM),
  customTimeTo: z.string().default(DEFAULT_CUSTOM_TIME_TO),
  customTimeUnit: z.string().default(DEFAULT_CUSTOM_TIME_UNIT),
  customSizeMin: z.string().default(DEFAULT_CUSTOM_SIZE_MIN),
  customSizeMax: z.string().default(DEFAULT_CUSTOM_SIZE_MAX),
  customSizeUnit: z.string().default(DEFAULT_CUSTOM_SIZE_UNIT),
  /** Payload composition (passed through to GraphQL → service); optional strings, not stripped. */
  comp_video: z.string().optional(),
  comp_audio: z.string().optional(),
  comp_archive: z.string().optional(),
  comp_app: z.string().optional(),
  comp_document: z.string().optional(),
  comp_image: z.string().optional(),
  comp_other: z.string().optional(),
});

const handler = async (request: Request) => {
  // Extract search parameters from the request URL
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams.entries());

  let safeParams;

  // Validate and parse the parameters using Zod schema
  try {
    const parsed = schema.parse(params);
    safeParams = {
      ...parsed,
      limit: normalizePageSize(parsed.limit),
    };
  } catch (error: any) {
    console.error(error);

    const { path, message } = error.errors[0] || {};
    const errMessage = path ? `${path[0]}: ${message}` : message;

    return NextResponse.json(
      {
        data: null,
        message: errMessage || "Invalid request",
        status: 400,
      },
      {
        status: 400,
      },
    );
  }

  // Perform the search query using Apollo Client
  try {
    const { data } = await client.query({
      query: SEARCH,
      variables: {
        queryInput: safeParams,
      },
      fetchPolicy: "no-cache",
    });

    return NextResponse.json(
      {
        data: data.search,
        message: "success",
        status: 200,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        data: null,
        message: error?.message || "Internal Server Error",
        status: 500,
      },
      {
        status: 500,
      },
    );
  }
};

export { handler as GET, handler as POST };
