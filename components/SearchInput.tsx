/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
"use client";

import { Input, Button, Spinner } from "@nextui-org/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { SearchIcon } from "@/components/icons";
import { SEARCH_URL_PRESERVE_KEYS } from "@/config/constant";
import { useSearchNavigationOptional } from "@/components/SearchNavigationProvider";
import {
  hasActiveDiscoveryFilters,
  searchFacetFromSearchParams,
} from "@/lib/searchUrl";
import { $env } from "@/utils";

export const SearchInput = ({
  defaultValue = "",
  isReplace = false,
  variant = "default",
}: {
  defaultValue?: string;
  isReplace?: boolean;
  /** Dark pill bar for the home landing page over the hero background. */
  variant?: "default" | "landing";
}) => {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [errMessage, setErrMessage] = useState("");
  const router = useRouter();
  const searchNav = useSearchNavigationOptional();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Reset loading state when search parameters change
    setLoading(false);
  }, [searchParams]);

  useEffect(() => {
    // Set default value for keyword when provided
    if (defaultValue) {
      setKeyword(defaultValue);
    }
  }, [defaultValue]);

  function handleSearch() {
    const trimmed = keyword.trim();
    setKeyword(trimmed);

    const facet = searchFacetFromSearchParams(searchParams);
    const discoveryOk =
      trimmed.length < 2 &&
      hasActiveDiscoveryFilters({ ...facet, keyword: trimmed });

    if (!trimmed && !discoveryOk) {
      return;
    }

    if (searchParams.get("keyword") === trimmed && !searchParams.get("p")) {
      return;
    }

    if (trimmed.length < 2 && !discoveryOk) {
      setErrMessage(t("Toast.keyword_too_short"));
      return;
    }

    let q = trimmed;
    if (q.length > 100) {
      q = q.slice(0, 100);
      setKeyword(q);
    }

    const params = new URLSearchParams();

    params.set("keyword", q);

    for (const key of SEARCH_URL_PRESERVE_KEYS) {
      const v = searchParams.get(key);
      if (v !== null && v !== "") {
        params.set(key, v);
      }
    }

    const url = `/search?${params.toString()}`;

    setLoading(true); // Set loading state to true
    if (isReplace) {
      router.replace(url);
    } else {
      router.push(url);
    }
  }

  function handleKeyup(e: any) {
    // Handle Enter key press for triggering search
    if (e.key === "Enter" || e.keyCode === 13) {
      // If on desktop, trigger search
      if (!$env.isMobile) {
        handleSearch();
      }

      // Blur input, on mobile that will trigger search
      e.target.blur();
    }
  }

  function handleBlur() {
    if ($env.isMobile) {
      // If on mobile, trigger search
      handleSearch();
    }

    setActive(false);
  }

  function handleFocus() {
    setErrMessage("");
    setActive(true);
  }

  const t = useTranslations(); // Translation function
  const isLanding = variant === "landing";

  return (
    <Input
      aria-label="Search"
      isDisabled={Boolean(searchNav?.isPending)}
      className={isLanding ? "w-full" : undefined}
      radius="full"
      classNames={{
        base: isLanding ? "w-full" : undefined,
        inputWrapper: clsx(
          "h-12 px-4",
          isLanding
            ? "h-14 min-h-14 rounded-full border border-zinc-600/60 bg-zinc-800/95 shadow-md backdrop-blur-sm data-[hover=true]:bg-zinc-800"
            : "rounded-full bg-default-100 shadow-sm",
        ),
        input: clsx(
          "text-base",
          isLanding && "text-zinc-100 placeholder:text-zinc-400",
        ),
        innerWrapper: isLanding ? "bg-transparent" : undefined,
        helperWrapper: "absolute bottom-[-25px]",
      }}
      defaultValue={defaultValue}
      endContent={
        <>
          <span
            className={clsx(
              "p-2 -m-2 z-10 invisible absolute right-[60px] appearance-none select-none opacity-0 hover:!opacity-60 cursor-pointer active:!opacity-40 rounded-full outline-none text-large transition-opacity motion-reduce:transition-none",
              isLanding && "text-zinc-400",
              { "!visible opacity-40": active && !!keyword }, // Show clear button if keyword is not empty
            )}
            onPointerDown={() => setKeyword("")}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              height="1em"
              role="presentation"
              viewBox="0 0 24 24"
              width="1em"
            >
              <path
                d="M12 2a10 10 0 1010 10A10.016 10.016 0 0012 2zm3.36 12.3a.754.754 0 010 1.06.748.748 0 01-1.06 0l-2.3-2.3-2.3 2.3a.748.748 0 01-1.06 0 .754.754 0 010-1.06l2.3-2.3-2.3-2.3A.75.75 0 019.7 8.64l2.3 2.3 2.3-2.3a.75.75 0 011.06 1.06l-2.3 2.3z"
                fill="currentColor"
              />
            </svg>
          </span>
          <Button
            isIconOnly
            className={clsx(
              "border-none active:bg-default",
              isLanding &&
                "text-zinc-300 hover:bg-zinc-700/80 data-[hover=true]:bg-zinc-700/80",
              { "cursor-progress": loading }, // Change cursor to progress when loading
            )}
            isDisabled={Boolean(searchNav?.isPending)}
            variant="ghost"
            onClick={handleSearch}
          >
            {loading ? ( // Show spinner if loading, else show search icon
              <Spinner
                className={isLanding ? "text-zinc-200" : undefined}
                size="sm"
              />
            ) : (
              <SearchIcon
                className={clsx(
                  "pointer-events-none flex-shrink-0 text-xl",
                  isLanding ? "text-zinc-300" : "text-default-400",
                )}
              />
            )}
          </Button>
        </>
      }
      errorMessage={errMessage}
      isInvalid={!!errMessage}
      labelPlacement="outside"
      placeholder={t("Search.placeholder")}
      value={keyword}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyUp={handleKeyup}
      onValueChange={setKeyword}
    />
  );
};
