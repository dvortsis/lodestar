"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { SEARCH_SESSION_STORAGE_KEY } from "@/config/constant";

const PERSIST_KEYS = [
  "ps",
  "sortType",
  "searchScope",
  "filterTime",
  "filterSize",
  "excludeWords",
  "excludeWordsEnabled",
  "advancedFiltersEnabled",
  "hideSpam",
  "keyword",
  "customTimeFrom",
  "customTimeTo",
  "customTimeUnit",
  "customSizeMin",
  "customSizeMax",
  "customSizeUnit",
  "comp_video",
  "comp_audio",
  "comp_archive",
  "comp_app",
  "comp_document",
  "comp_image",
  "comp_other",
] as const;

/**
 * Restores facet params from sessionStorage when missing from the URL.
 * URL query entries always win over session when both are set.
 * Persists current URL search params (except page) on change.
 */
export function useSearchSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || hydrated.current) {
      return;
    }
    hydrated.current = true;

    let stored: Record<string, string> = {};
    try {
      const raw = sessionStorage.getItem(SEARCH_SESSION_STORAGE_KEY);
      if (raw) {
        stored = JSON.parse(raw) as Record<string, string>;
      }
    } catch {
      stored = {};
    }

    const current = new URLSearchParams(window.location.search);
    let changed = false;
    const merged = new URLSearchParams(current.toString());

    for (const key of PERSIST_KEYS) {
      const has =
        current.has(key) &&
        current.get(key) !== null &&
        current.get(key) !== "";
      if (!has && stored[key] != null && stored[key] !== "") {
        merged.set(key, stored[key]);
        changed = true;
      }
    }

    if (changed) {
      merged.set("p", "1");
      router.replace(`/search?${merged.toString()}`);
    }
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const o: Record<string, string> = {};
    searchParams.forEach((v, k) => {
      if (k !== "p") {
        o[k] = v;
      }
    });
    try {
      sessionStorage.setItem(SEARCH_SESSION_STORAGE_KEY, JSON.stringify(o));
    } catch {
      /* ignore quota */
    }
  }, [searchParams]);
}
