import type { LucideIcon } from "lucide-react";
import { Cpu, Database } from "lucide-react";

import type { CompanySlug } from "@/lib/companies";
import type { ReportSpec } from "@/lib/report";

export type CategoryStatus = "live" | "planned";

export type PlannedCompany = {
  company: CompanySlug;
  /** Product label when it differs from the company name. */
  label?: string;
};

export type Category = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: CategoryStatus;
  icon: LucideIcon;
  /** Headline metrics this category measures (or will). */
  metrics: string[];
  /** For planned categories: companies/products on the roadmap. */
  plannedCompanies?: PlannedCompany[];
  /**
   * Live categories: the declarative report every page renders from —
   * homepage leaders, category sections, ledger columns, scatter axes.
   * A new benchmark category adds one spec and its pages exist.
   */
  report?: ReportSpec;
};

// Adding a category = adding an entry here plus result files with a matching
// `category` field in data/results/. Pages, nav and provider views pick it up.
// Going live = attaching a `report` spec; every page then renders itself.
export const CATEGORIES: Category[] = [
  {
    slug: "compute",
    name: "Compute",
    tagline: "VPS & dedicated servers",
    description:
      "CPU, memory, disk and network performance — plus contention and consistency signals that a spec sheet cannot show.",
    status: "live",
    icon: Cpu,
    metrics: [
      "CPU single/all-core",
      "Memory bandwidth & latency",
      "Disk IOPS & fsync",
      "Network throughput",
      "CPU steal & consistency",
    ],
    report: {
      leaderCharts: [
        { test: "cpu", metric: "single_core_hash" },
        { test: "cpu", metric: "multi_core_hash" },
        { test: "disk", metric: "rand_read_4k" },
        { test: "network", metric: "download" },
        { test: "steal", metric: "cpu_steal" },
        { test: "disk", metric: "fsync_latency_p50" },
      ],
      sections: [
        {
          title: "Raw performance",
          description:
            "Identical deterministic workloads on every machine — differences are the hardware, never the benchmark.",
          charts: [
            { test: "cpu", metric: "single_core_hash" },
            { test: "cpu", metric: "multi_core_hash" },
            { test: "memory", metric: "copy_bandwidth" },
            { test: "memory", metric: "random_access_latency" },
            { test: "disk", metric: "rand_read_4k" },
            { test: "network", metric: "download" },
          ],
        },
        {
          title: "Contention & consistency signals",
          description:
            "Identical work should have a stable runtime. These metrics expose variance, tail latency and hypervisor-reported steal time without assigning a single cause.",
          charts: [
            { test: "steal", metric: "consistency_cv" },
            { test: "steal", metric: "cpu_steal" },
            { test: "steal", metric: "p99_over_p50" },
            { test: "disk", metric: "fsync_latency_p50" },
          ],
        },
      ],
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
        { id: "cpu-multi", test: "cpu", metric: "multi_core_hash", shortLabel: "CPU all-core" },
        { id: "cpu-single", test: "cpu", metric: "single_core_hash", shortLabel: "CPU 1-core" },
        { id: "memory", test: "memory", metric: "copy_bandwidth", shortLabel: "Memory BW" },
        { id: "disk", test: "disk", metric: "rand_read_4k", shortLabel: "4K read" },
        { id: "network", test: "network", metric: "download", shortLabel: "Download" },
      ],
    },
  },
  // AI inference is deliberately absent until we actually measure it — no
  // empty dashboards. Re-add the category entry here when the suite ships.
  {
    slug: "storage",
    name: "Object Storage",
    tagline: "S3-compatible & blob stores",
    description:
      "Upload and download throughput, time to first byte, small-object latency and list performance — R2 vs S3 vs the rest, from multiple regions.",
    status: "planned",
    icon: Database,
    metrics: [
      "Upload / download throughput",
      "Time to first byte",
      "Small-object p50/p99",
      "List operations",
      "Egress cost per TB",
    ],
    plannedCompanies: [
      { company: "cloudflare", label: "Cloudflare R2" },
      { company: "aws", label: "AWS S3" },
      { company: "backblaze", label: "Backblaze B2" },
      { company: "google", label: "Google Cloud Storage" },
      { company: "tigris" },
    ],
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
