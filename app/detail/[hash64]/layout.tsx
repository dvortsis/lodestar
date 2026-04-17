import { Link } from "@nextui-org/react";

import { FloatTool } from "@/components/FloatTool";
import { SearchInput } from "@/components/SearchInput";
import { LodestarBrandIcon } from "@/components/LodestarBrandIcon";
import { siteConfig } from "@/config/site";

export default function DetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col justify-center gap-4 px-3 py-3 md:py-8">
      <div className="flex items-center mb-4">
        <Link
          className="mb-[-2px] mr-2 inline-flex items-center justify-center md:mr-4"
          href="/"
          title={siteConfig.name}
        >
          <LodestarBrandIcon className="h-11 w-11 object-contain md:h-14 md:w-14" />
        </Link>
        <SearchInput />
      </div>
      {children}
      <FloatTool />
    </section>
  );
}
