import { createAppApolloClient } from "@/lib/createApolloClient";

/** Browser / same-origin: relative URI (invalid in Node; do not import this module from Route Handlers). */
export default createAppApolloClient("/api/graphql");
