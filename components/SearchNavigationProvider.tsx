"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

export type SearchNavigationContextValue = {
  isPending: boolean;
  /** Wraps client navigation in `startTransition` so `isPending` tracks route updates. */
  navigateSearch: (href: string, options?: { replace?: boolean }) => void;
};

const SearchNavigationContext =
  createContext<SearchNavigationContextValue | null>(null);

export function SearchNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigateSearch = useCallback(
    (href: string, options?: { replace?: boolean }) => {
      startTransition(() => {
        if (options?.replace) {
          router.replace(href);
        } else {
          router.push(href);
        }
      });
    },
    [router],
  );

  const value = useMemo(
    () => ({ isPending, navigateSearch }),
    [isPending, navigateSearch],
  );

  return (
    <SearchNavigationContext.Provider value={value}>
      {children}
    </SearchNavigationContext.Provider>
  );
}

export function useSearchNavigation(): SearchNavigationContextValue {
  const ctx = useContext(SearchNavigationContext);
  if (!ctx) {
    throw new Error(
      "useSearchNavigation must be used within SearchNavigationProvider",
    );
  }
  return ctx;
}

export function useSearchNavigationOptional(): SearchNavigationContextValue | null {
  return useContext(SearchNavigationContext);
}
