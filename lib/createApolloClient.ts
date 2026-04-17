import { ApolloClient, InMemoryCache, from, HttpLink } from "@apollo/client";
import type { UriFunction } from "@apollo/client/link/http";
import { removeTypenameFromVariables } from "@apollo/client/link/remove-typename";

/** String for browser (relative); function deferred until each request (Route Handlers need `headers()`). */
export function createAppApolloClient(uri: string | UriFunction) {
  const httpLink = new HttpLink({ uri });
  const removeTypename = removeTypenameFromVariables();

  return new ApolloClient({
    cache: new InMemoryCache(),
    link: from([removeTypename, httpLink]),
    defaultOptions: {
      query: { fetchPolicy: "network-only" },
      watchQuery: { fetchPolicy: "network-only" },
    },
  });
}
