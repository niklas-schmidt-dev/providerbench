"use client";

import { BarChart3, Building2, LayoutDashboard, LineChart, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import {
  CommandPalette,
  CommandPaletteDialogContent,
  CommandPaletteTrigger,
} from "@/components/premium/command-palette/dialog-command-palette";
import { CommandKbd } from "@/components/premium/command-palette/command-palette-kbd";
import type { MorphicCommandItem } from "@/components/premium/command-palette/command-palette-types";
import { currentHash } from "@/lib/hash";
import type { SearchEntry } from "@/lib/search-index";

const ICONS = { page: LayoutDashboard, chart: LineChart, metric: BarChart3, provider: Building2 };

/** Global ⌘K search over pages, charts, benchmarks and providers. */
export function SiteSearch({ entries }: { entries: SearchEntry[] }) {
  const router = useRouter();

  const items = useMemo<MorphicCommandItem[]>(() => {
    const open = (href: string) => () => {
      const [path, anchor] = href.split("#");
      if (!anchor || window.location.pathname !== path) return router.push(href);
      // Already on that dashboard: set the hash natively so the browser
      // scrolls and listeners (metric deep links) see a hashchange.
      if (currentHash() !== anchor) return void (window.location.hash = anchor);
      // Same fragment: scroll and re-announce it so the metric is selected again.
      document.getElementById(anchor)?.scrollIntoView();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    };
    return entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      hint: entry.hint,
      group: entry.group,
      keywords: entry.keywords,
      icon: ICONS[entry.kind],
      onSelect: open(entry.href),
    }));
  }, [router, entries]);

  return (
    <CommandPalette items={items} shortcut="k" labels={{ placeholder: "Benchmarks, providers, pages…" }}>
      <CommandPaletteTrigger
        aria-label="Search"
        className="h-8 gap-2 rounded-md border-border px-2.5 text-[13px] text-muted-foreground hover:text-foreground sm:w-52"
      >
        <Search aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <CommandKbd keys={["⌘", "K"]} className="ml-auto hidden sm:inline-flex" />
      </CommandPaletteTrigger>
      <CommandPaletteDialogContent placeholder="Benchmarks, providers, pages…" />
    </CommandPalette>
  );
}
