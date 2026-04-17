import "server-only";

import { createAppApolloClient } from "@/lib/createApolloClient";
import { resolveServerApiUrl } from "@/utils/resolveServerApiUrl";

/** Route Handlers: URI resolved per operation so `headers()` runs inside the request, not at import time. */
export default createAppApolloClient((_operation) =>
  resolveServerApiUrl("/api/graphql"),
);
