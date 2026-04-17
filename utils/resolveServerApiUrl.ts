import "server-only";

import { headers } from "next/headers";

/**
 * Server-side calls to this app's own HTTP routes must use an absolute URL
 * (Node fetch / Apollo HttpLink cannot use origin-relative paths).
 *
 * Optional `INTERNAL_APP_URL` (e.g. `http://127.0.0.1:3000` in Docker) overrides
 * request headers when they are missing or not reachable from the server process.
 */
export function resolveServerApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  const explicit = process.env.INTERNAL_APP_URL?.replace(/\/$/, "");
  if (explicit) {
    return `${explicit}${normalized}`;
  }

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) {
    return `${proto}://${host}${normalized}`;
  }

  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}${normalized}`;
}
