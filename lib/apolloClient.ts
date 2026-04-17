import { ApolloClient, InMemoryCache, from, HttpLink } from "@apollo/client";
import { removeTypenameFromVariables } from "@apollo/client/link/remove-typename";

import { getBaseUrl } from "@/utils/api";

const httpLink = new HttpLink({
  uri: `${getBaseUrl()}/api/graphql`, // 从环境变量中获取 URI
});

const removeTypename = removeTypenameFromVariables();

const client = new ApolloClient({
  /** Default `addTypename: true` so the cache can normalize by `__typename` + `id` / `keyFields`. */
  cache: new InMemoryCache(),
  link: from([removeTypename, httpLink]),
  /** Temporary: always hit network so search/schema changes are not masked by Apollo cache. */
  defaultOptions: {
    query: { fetchPolicy: "network-only" },
    watchQuery: { fetchPolicy: "network-only" },
  },
});

export default client;
