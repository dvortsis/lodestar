import { FloatTool } from "@/components/FloatTool";
import { SearchNavigationProvider } from "@/components/SearchNavigationProvider";

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SearchNavigationProvider>
      <section className="flex max-w-full min-w-0 flex-col justify-center gap-4 px-3 py-3 pb-6 md:py-8">
        {children}
      </section>
      <FloatTool />
    </SearchNavigationProvider>
  );
}
