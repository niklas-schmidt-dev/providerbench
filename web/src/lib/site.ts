// The site's table of contents, read from the data: every category that has
// a published report, that the CLI can measure, or that the registry
// describes. Server-only: it reads the dataset from disk.

import { categoryHref, categoryMeta, categoryRoute, CATEGORY_ORDER } from "@/lib/categories";
import { loadCatalog, loadRuns, type CatalogTest } from "@/lib/data";

export type SiteCategory = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  href: string;
  /** At least one published report. */
  live: boolean;
  reports: number;
  providers: number;
  /** Newest report, ISO date. */
  updated?: string;
  /** The protocol the CLI pins for this category, when it measures it. */
  protocol?: string;
  tests: CatalogTest[];
};

let categories: SiteCategory[] | undefined;

export function siteCategories(): SiteCategory[] {
  categories ??= readCategories();
  return categories;
}

function readCategories(): SiteCategory[] {
  const runs = loadRuns();
  const catalog = new Map(loadCatalog().map((entry) => [entry.name, entry]));
  const slugs = new Set([...CATEGORY_ORDER, ...catalog.keys(), ...runs.map((run) => run.category ?? "compute")]);
  const routes = new Map<string, string>();
  for (const slug of slugs) {
    const route = categoryRoute(slug);
    const other = routes.get(route);
    if (other) throw new Error(`categories "${other}" and "${slug}" share the /${route} page — rename one`);
    routes.set(route, slug);
  }
  const rank = (slug: string) => {
    const index = CATEGORY_ORDER.indexOf(slug);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...slugs]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((slug) => {
      const meta = categoryMeta(slug);
      const own = runs.filter((run) => (run.category ?? "compute") === slug);
      return {
        slug,
        name: meta.name,
        tagline: meta.tagline,
        description: meta.description,
        href: categoryHref(slug),
        live: own.length > 0,
        reports: own.length,
        providers: new Set(own.map((run) => run.provider.name)).size,
        updated: own.map((run) => run.created_at).sort().at(-1),
        protocol: catalog.get(slug)?.protocol,
        tests: catalog.get(slug)?.tests ?? [],
      };
    });
}

/** The category whose page lives at this path segment. */
export function siteCategoryAt(route: string): SiteCategory | undefined {
  return siteCategories().find((category) => categoryRoute(category.slug) === route);
}
