"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type View = { id: string; label: string };

/**
 * Sticky chart navigation. Every view is a section on one scrolling page;
 * the tab of the section in view is underlined, a click scrolls to it.
 */
export function ViewTabs({
  views,
  onOpenPlans,
  planSummary,
}: {
  views: View[];
  onOpenPlans: () => void;
  planSummary: string;
}) {
  const [active, setActive] = useState(views[0]?.id);

  // Scroll spy: the active view is the last section whose top has passed
  // the sticky header and tab bar.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      let current = views[0]?.id;
      for (const view of views) {
        const section = document.getElementById(view.id);
        if (section && section.getBoundingClientRect().top <= offset + 24) current = view.id;
      }
      // At the very bottom the last short sections can never reach the top.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = views[views.length - 1]?.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [views]);

  return (
    <div className="sticky top-(--header-height) z-30 flex items-center border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
      <nav aria-label="Chart views" className="no-scrollbar flex min-w-0 flex-1 gap-6 overflow-x-auto px-4 sm:px-7">
        {views.map((view) => (
          <a
            key={view.id}
            href={`#${view.id}`}
            aria-current={active === view.id ? "location" : undefined}
            className={cn(
              "relative flex h-11 shrink-0 items-center text-[13px] whitespace-nowrap transition-colors",
              "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:transition-colors",
              active === view.id
                ? "text-foreground after:bg-foreground"
                : "text-subtle after:bg-transparent hover:text-foreground",
            )}
          >
            {view.label}
          </a>
        ))}
      </nav>
      <button
        type="button"
        onClick={onOpenPlans}
        className="flex h-11 shrink-0 items-center gap-2 border-l border-border px-4 text-[13px] text-muted-foreground transition-colors hover:text-foreground lg:hidden"
      >
        <SlidersHorizontal aria-hidden className="size-3.5" />
        {planSummary}
      </button>
    </div>
  );
}
