import Link from "next/link";

import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

// The category switcher strip under a hero: underline tabs for every
// benchmark category, live ones linked, planned ones present but quiet.
export function CategoryBar({
  active,
  right,
}: {
  active?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-b border-(--border-hairline) bg-card">
      <div className="mx-auto flex min-h-[46px] max-w-(--content-max) flex-wrap items-center gap-4 px-4 sm:px-8">
        <div className="flex gap-[18px] overflow-x-auto no-scrollbar">
          {CATEGORIES.map((c) => {
            const on = c.slug === active;
            const className = cn(
              "-mb-px whitespace-nowrap border-b-2 pt-[13px] pb-[11px] text-[13.5px] tracking-[-0.005em] transition-colors",
              on
                ? "border-gray-950 font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            );
            return c.status === "live" ? (
              <Link key={c.slug} href={`/${c.slug}`} className={className}>
                {c.name}
              </Link>
            ) : (
              <Link
                key={c.slug}
                href={`/${c.slug}`}
                className={className}
                title="Planned — not yet measuring"
              >
                {c.name}
                <span className="ml-1.5 align-[1px] text-[10px] tracking-[0.06em] text-(--text-faint) uppercase">
                  soon
                </span>
              </Link>
            );
          })}
        </div>
        <div className="flex-1" />
        {right}
      </div>
    </div>
  );
}
