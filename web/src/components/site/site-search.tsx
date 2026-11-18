"use client";

import { BarChart3, Building2, FileTerminal, LayoutDashboard, LineChart, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import {
  CommandPalette,
  CommandPaletteDialogContent,
  CommandPaletteTrigger,
} from "@/components/premium/command-palette/dialog-command-palette";
import { CommandKbd } from "@/components/premium/command-palette/command-palette-kbd";
import type { MorphicCommandItem } from "@/components/premium/command-palette/command-palette-types";
import { CATEGORIES } from "@/lib/categories";
import { METRICS } from "@/lib/metrics";
import { PROVIDERS } from "@/lib/providers";

const CHART_VIEWS = [
  { id: "price-performance", label: "Price vs performance", keywords: ["cost", "scatter", "pareto"] },
  { id: "value", label: "Work per euro", keywords: ["value", "price", "cheap"] },
  { id: "board", label: "The board", keywords: ["table", "ranking", "leaderboard"] },
  { id: "method", label: "How the numbers are made", keywords: ["methodology", "scoring", "weights"] },
];

/** Global ⌘K search over pages, charts, benchmarks and providers. */
export function SiteSearch({ providersWithRuns }: { providersWithRuns: string[] }) {
  const router = useRouter();

  const items = useMemo<MorphicCommandItem[]>(() => {
    const go = (href: string) => () => router.push(href);
    const withRuns = new Set(providersWithRuns);
    return [
      { id: "page-home", label: "Compute dashboard", group: "Pages", icon: LayoutDashboard, onSelect: go("/") },
      ...CATEGORIES.filter((c) => c.status !== "live").map((c) => ({
        id: `page-${c.slug}`,
        label: `${c.name} benchmarks`,
        description: "Planned",
        group: "Pages",
        icon: BarChart3,
        onSelect: go(`/${c.slug}`),
      })),
      { id: "page-providers", label: "All providers", group: "Pages", icon: Building2, onSelect: go("/providers") },
      {
        id: "page-cli",
        label: "CLI & contributing",
        group: "Pages",
        icon: FileTerminal,
        keywords: ["install", "run", "method", "submit"],
        onSelect: go("/cli"),
      },
      ...CHART_VIEWS.map((view) => ({
        id: `chart-${view.id}`,
        label: view.label,
        group: "Charts",
        icon: LineChart,
        keywords: view.keywords,
        onSelect: go(`/#${view.id}`),
      })),
      ...METRICS.map((m) => ({
        id: `metric-${m.test}-${m.metric}`,
        label: m.title,
        hint: m.unit,
        group: "Benchmarks",
        icon: BarChart3,
        keywords: [m.test, m.metric],
        onSelect: go(`/#${m.test}`),
      })),
      ...PROVIDERS.map((p) => ({
        id: `provider-${p.slug}`,
        label: p.name,
        description: withRuns.has(p.slug) ? undefined : "Awaiting data",
        group: "Providers",
        icon: Building2,
        onSelect: go(withRuns.has(p.slug) ? `/providers/${p.slug}` : "/providers"),
      })),
    ];
  }, [router, providersWithRuns]);

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
