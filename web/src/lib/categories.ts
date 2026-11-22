import type { CompanySlug } from "@/lib/companies";
import type { ReportSpec } from "@/lib/report";
import { humanize } from "@/lib/text";

export type PlannedCompany = {
  company: CompanySlug;
  /** Product label when it differs from the company name. */
  label?: string;
};

/**
 * How a category presents itself. Nothing here is required for a category to
 * appear: a report with an unknown `category` gets a page laid out from its
 * own tests and metrics. An entry adds the words a report cannot carry.
 */
export type CategoryMeta = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** What one row of the board is. A report calls it `provider.plan`. */
  noun: { one: string; many: string };
  /** Headline and lead of the dashboard. Default: the name and the description. */
  headline?: string;
  lead?: string;
  /** The machine that ran the test is what was measured, so its CPU and memory describe the row. */
  measuresMachine?: boolean;
  /** Directory under internal/tests that holds the suite's source. */
  sourceDir?: string;
  /** Tests in this order first; the rest follow in the order reports list them. */
  testOrder?: string[];
  /** Curated columns and axes. Without it, every metric of the reports is offered. */
  report?: ReportSpec;
  /** A short label for a metric whose name alone reads badly. */
  metricLabel?: (test: string, metric: string) => string | undefined;
  /** Label for a variant key of a test's outcomes (a language code). */
  variantLabel?: (variant: string) => string | undefined;
  /** Title of the table that sets a test's like-for-like metrics side by side. */
  matrixTitle?: string;
  /** The items of a test come in this many equal groups, in order. */
  itemGroups?: { count: number; label: string };
  /** Shown while the category has no published report. */
  roadmap?: { metrics?: string[]; companies?: PlannedCompany[] };
};

const LANGUAGES = new Map([
  ["en", "English"],
  ["de", "German"],
  ["es", "Spanish"],
  ["zh", "Chinese"],
]);

// Order here is the order in the navigation. Categories that exist only in
// the data or in the CLI's catalog follow, sorted by name.
const REGISTRY: CategoryMeta[] = [
  {
    slug: "compute",
    name: "Compute",
    tagline: "VPS & dedicated servers",
    description:
      "CPU, memory, disk and network performance — plus contention and consistency signals that a spec sheet cannot show.",
    noun: { one: "plan", many: "plans" },
    headline: "Measured, not marketed.",
    lead: "Every provider sells “vCPUs” and “NVMe”. We measure what you actually get: fresh hosts, one open harness, every sample published as raw JSON.",
    measuresMachine: true,
    sourceDir: "compute",
    testOrder: ["cpu", "memory", "disk", "network", "steal"],
    report: {
      tableMetrics: [
        { test: "cpu", metric: "single_core_hash", shortLabel: "CPU 1-core" },
        { test: "cpu", metric: "multi_core_hash", shortLabel: "CPU all-core" },
        { test: "memory", metric: "copy_bandwidth", shortLabel: "Mem BW", decimals: 1 },
        { test: "disk", metric: "seq_write", shortLabel: "Seq write" },
        { test: "disk", metric: "rand_read_4k", shortLabel: "4K read" },
        { test: "disk", metric: "fsync_latency_p50", shortLabel: "fsync p50", decimals: 2 },
        { test: "network", metric: "download", shortLabel: "Download" },
        { test: "steal", metric: "consistency_cv", shortLabel: "Consistency", decimals: 1 },
        { test: "steal", metric: "cpu_steal", shortLabel: "Steal", decimals: 2 },
      ],
      scatterMetrics: [
        { test: "cpu", metric: "multi_core_hash", shortLabel: "CPU all-core" },
        { test: "cpu", metric: "single_core_hash", shortLabel: "CPU 1-core" },
        { test: "memory", metric: "copy_bandwidth", shortLabel: "Memory BW" },
        { test: "disk", metric: "rand_read_4k", shortLabel: "4K read" },
        { test: "network", metric: "download", shortLabel: "Download" },
      ],
    },
  },
  {
    slug: "workload",
    name: "Workload",
    tagline: "Application work",
    description:
      "What a server gets done in the work applications do: compression, JSON, TLS handshakes, HTTP requests, sorting, key lookups and allocation, on one core and on all of them.",
    noun: { one: "plan", many: "plans" },
    measuresMachine: true,
    sourceDir: "workload",
  },
  {
    slug: "platform",
    name: "Platform",
    tagline: "Kernel & virtualization overhead",
    description:
      "What the platform under a workload costs: system calls, thread wake-ups, first-touch memory, small-file operations and scheduling stalls.",
    noun: { one: "plan", many: "plans" },
    measuresMachine: true,
    sourceDir: "platform",
  },
  {
    slug: "reach",
    name: "Reach",
    tagline: "Network distance to the world",
    description: "Round-trip time from a plan's datacenter to fixed anchors in nine cloud regions on six continents.",
    noun: { one: "plan", many: "plans" },
    sourceDir: "reach",
    matrixTitle: "Round-trip time by region",
    metricLabel: (_test, metric) =>
      metric.startsWith("rtt_") ? metric.slice("rtt_".length).replaceAll("_", "-") : undefined,
  },
  {
    slug: "storage",
    name: "Object Storage",
    tagline: "S3-compatible & blob stores",
    description:
      "Upload and download throughput, time to first byte, small-object latency and list performance — R2 vs S3 vs the rest, from multiple regions.",
    noun: { one: "plan", many: "plans" },
    sourceDir: "storage",
    roadmap: {
      companies: [
        { company: "cloudflare", label: "Cloudflare R2" },
        { company: "aws", label: "AWS S3" },
        { company: "backblaze", label: "Backblaze B2" },
        { company: "google", label: "Google Cloud Storage" },
        { company: "tigris" },
      ],
    },
  },
  {
    slug: "ai-language",
    name: "AI language",
    tagline: "Language models by input language",
    description:
      "The same generated problems in English, German, Spanish and Chinese: what a model solves when only the language of the question changes.",
    noun: { one: "model", many: "models" },
    sourceDir: "ai",
    matrixTitle: "Problems solved by input language",
    itemGroups: { count: 5, label: "Level" },
    variantLabel: (variant) => LANGUAGES.get(variant),
    metricLabel: (_test, metric) => {
      const code = metric.startsWith("accuracy_") ? metric.slice("accuracy_".length) : undefined;
      return code ? (LANGUAGES.get(code) ?? code.toUpperCase()) : undefined;
    },
  },
];

const bySlug = new Map(REGISTRY.map((meta) => [meta.slug, meta]));

/** Registered categories in navigation order. */
export const CATEGORY_ORDER = REGISTRY.map((meta) => meta.slug);

/** The category whose dashboard is the homepage. */
export const HOME_CATEGORY = "compute";

/** Top-level routes a category slug must not shadow. */
export const RESERVED_SLUGS = ["benchmarks", "cli", "providers"];

export function categoryMeta(slug: string): CategoryMeta {
  return (
    bySlug.get(slug) ?? {
      slug,
      name: humanize(slug),
      tagline: "",
      description: `Reports of the ${slug} category, laid out from their own tests and metrics.`,
      noun: { one: "plan", many: "plans" },
    }
  );
}

export function categoryHref(slug: string): string {
  return slug === HOME_CATEGORY ? "/" : `/${slug}`;
}

export function variantLabel(meta: CategoryMeta, variant: string): string {
  return meta.variantLabel?.(variant) ?? humanize(variant);
}
