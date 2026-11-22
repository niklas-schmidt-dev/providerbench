// The ⌘K index, built from the data at build time: every category, every
// chart and metric of the categories that have reports, every provider.
// Server-only; the client receives plain entries.

import { loadDashboard } from "@/lib/dashboard-data";
import { loadRuns } from "@/lib/data";
import { getProvider, PROVIDERS } from "@/lib/providers";
import { siteCategories } from "@/lib/site";

export type SearchEntry = {
  id: string;
  kind: "page" | "chart" | "metric" | "provider";
  label: string;
  group: string;
  description?: string;
  hint?: string;
  keywords?: string[];
  /** A path, with a #fragment for a place on a dashboard. */
  href: string;
};

export function buildSearchIndex(): SearchEntry[] {
  const categories = siteCategories();
  const live = categories.filter((category) => category.live);
  const entries: SearchEntry[] = [];

  for (const category of categories) {
    entries.push({
      id: `page-${category.slug}`,
      kind: "page",
      label: category.live ? `${category.name} dashboard` : `${category.name} benchmarks`,
      description: category.live ? undefined : "No reports yet",
      group: "Pages",
      keywords: [category.slug, category.tagline],
      href: category.href,
    });
  }
  entries.push(
    { id: "page-benchmarks", kind: "page", label: "All benchmarks", group: "Pages", keywords: ["categories", "suites"], href: "/benchmarks" },
    { id: "page-providers", kind: "page", label: "All providers", group: "Pages", href: "/providers" },
    {
      id: "page-cli",
      kind: "page",
      label: "CLI & contributing",
      group: "Pages",
      keywords: ["install", "run", "method", "submit"],
      href: "/cli",
    },
  );

  for (const category of live) {
    const dashboard = loadDashboard(category.slug);
    // With several dashboards, an entry says which one it belongs to.
    const where = live.length > 1 ? category.name : undefined;
    const at = (anchor: string) => `${category.href}#${anchor}`;
    const chart = (anchor: string, label: string, keywords: string[] = []): SearchEntry => ({
      id: `chart-${category.slug}-${anchor}`,
      kind: "chart",
      label,
      description: where,
      group: "Charts",
      keywords,
      href: at(anchor),
    });
    if (dashboard.priced && dashboard.yOptions.length > 0) {
      entries.push(chart("price-performance", "Price vs performance", ["cost", "scatter", "pareto"]));
    }
    if (dashboard.scored && dashboard.priced) entries.push(chart("value", "Work per euro", ["value", "price", "cheap"]));
    for (const section of dashboard.sections) {
      if (section.kind !== "suite") entries.push(chart(section.id, section.title, [section.tab]));
    }
    entries.push(
      chart("board", "The board", ["table", "ranking", "leaderboard"]),
      chart("method", "How the numbers are made", ["methodology", "scoring", "weights", "protocol"]),
    );

    const metric = (test: string, name: string, label: string, unit: string): SearchEntry => ({
      id: `metric-${category.slug}-${test}-${name}`,
      kind: "metric",
      label,
      description: where,
      hint: unit,
      group: "Benchmarks",
      keywords: [test, name],
      href: at(`${test}-${name}`),
    });
    for (const section of dashboard.sections) {
      if (section.kind === "suite") {
        for (const info of section.metrics) entries.push(metric(info.test, info.metric, info.title, info.unit));
      } else if (section.kind === "matrix") {
        for (const test of section.tests) {
          for (const column of section.columns) {
            entries.push(metric(test.test, column.metric, `${test.label} · ${column.label}`, section.unit));
          }
        }
      }
    }
  }

  const withRuns = new Set(loadRuns().flatMap((run) => (run.provider.name ? [run.provider.name] : [])));
  const providers = [...new Set([...PROVIDERS.map((provider) => provider.slug), ...[...withRuns].sort()])];
  for (const slug of providers) {
    entries.push({
      id: `provider-${slug}`,
      kind: "provider",
      label: getProvider(slug).name,
      description: withRuns.has(slug) ? undefined : "Awaiting data",
      group: "Providers",
      keywords: [slug],
      href: withRuns.has(slug) ? `/providers/${slug}` : "/providers",
    });
  }
  return entries;
}
