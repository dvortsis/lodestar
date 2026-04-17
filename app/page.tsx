import { LodestarBrandIcon } from "@/components/LodestarBrandIcon";
import { SearchInput } from "@/components/SearchInput";
import { Stats } from "@/components/Stats";
import { siteConfig } from "@/config/site";

const HOMEPAGE_REPO_URL = "https://github.com/dvortsis/lodestar";

/**
 * Lodestar landing — intentional minimalism.
 *
 * Language and theme controls live elsewhere (e.g. search); this surface strips chrome so the
 * first impression is discovery-only: brand, one line of positioning, search, repo attribution,
 * and optional stats — nothing competing for attention before the user commits to a query.
 */
export default function Home() {
  return (
    <section className="relative mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-5 pb-10 pt-12 md:max-w-2xl md:px-8">
      <div className="flex min-h-[calc(100dvh-6.5rem)] flex-col items-center justify-center gap-10">
        <div className="flex flex-col items-center gap-7 text-center">
          <LodestarBrandIcon className="h-[7.5rem] w-[7.5rem] object-contain md:h-[8.25rem] md:w-[8.25rem]" />
          <h1 className="px-2 font-sans text-4xl font-bold tracking-tight text-white md:text-5xl">
            {siteConfig.name}
          </h1>
          <p className="max-w-md px-2 font-sans text-sm font-light leading-relaxed text-white/85 md:text-base">
            A beautiful and intuitive front end for Bitmagnet.
          </p>
        </div>
        <div className="w-full max-w-lg px-0 sm:px-1">
          <SearchInput variant="landing" />
        </div>
      </div>

      <footer className="mt-auto shrink-0 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 text-center font-sans text-[11px] leading-relaxed text-neutral-400 md:text-xs">
        <span>Repository: </span>
        <span className="text-white" aria-hidden>
          🤍
        </span>{" "}
        <a
          className="text-neutral-400 underline-offset-2 transition-colors hover:text-neutral-200 hover:underline"
          href={HOMEPAGE_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          {HOMEPAGE_REPO_URL}
        </a>
      </footer>

      <div className="fixed bottom-4 right-4 invisible md:visible">
        <Stats />
      </div>
    </section>
  );
}
