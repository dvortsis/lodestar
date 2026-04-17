"use client";

import clsx from "clsx";
import { useState } from "react";

import { LodestarBrandIcon } from "@/components/LodestarBrandIcon";
import { siteConfig } from "@/config/site";
import { $env } from "@/utils";

export const HomeLogo = () => {
  const [isAnimating, setIsAnimating] = useState(false);

  const doClickAnimation = () => {
    if (!$env.isMobile) {
      return;
    }

    if (isAnimating) {
      return;
    }

    setIsAnimating(true);

    setTimeout(() => {
      setIsAnimating(false);
    }, 400);
  };

  return (
    <h1
      className="logo flex flex-col items-center gap-4 text-center"
      title={siteConfig.brandTitle}
      onPointerDown={() => doClickAnimation()}
    >
      <LodestarBrandIcon
        className={clsx(
          "h-[140px] w-[140px] object-contain transition-all duration-400 hover:scale-105",
          isAnimating && "animate-pop",
        )}
      />
      <span className="max-w-xl px-3 text-lg font-medium leading-snug tracking-tight text-foreground md:text-xl">
        {siteConfig.brandTitle}
      </span>
    </h1>
  );
};
