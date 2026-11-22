import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

export type Metric = {
  name: string;
  value: number;
  unit: string;
  higher_is_better: boolean;
};

export type TestResult = {
  test: string;
  started_at: string;
  duration_seconds: number;
  metrics: Metric[];
  notes?: string[];
  /**
   * How each item of a test went, per variant of the items (a language in
   * the ai-language suite): one character per item in protocol order,
   * 1 solved, 0 wrong, - no usable answer.
   */
  outcomes?: Record<string, string>;
  error?: string;
};

export type Report = {
  schema_version: number;
  protocol_version?: string;
  profile?: "standard" | "sustained";
  cli_version: string;
  category?: string;
  created_at: string;
  sample?: boolean;
  quick?: boolean; // smaller --quick workloads; never enters ranked aggregates
  provider: {
    name?: string; // the company: hetzner, vercel, aws
    product?: string; // the offering tested: Cloud VPS, Sandbox, EC2
    plan?: string;
    tier?: "cheap" | "medium" | "dedicated" | "usage-based";
    region?: string;
    price_eur_hour?: number;
    price_eur_month?: number;
  };
  measurement?: {
    campaign_id?: string;
    sample_index?: number;
    repeat_index?: number;
    fresh_instance?: boolean;
    exclude_from_aggregate?: boolean;
  };
  environment?: Record<string, string>;
  system: {
    os: string;
    arch: string;
    kernel?: string;
    cpu_model?: string;
    cpu_cores: number;
    mem_total_mb?: number;
    virtualization?: string;
  };
  results: TestResult[];
};

export type ManifestEntry = {
  file: string;
  sha256: string;
  schema_version: number;
  protocol_version: string;
  profile: "standard" | "sustained";
  category: string;
  cohort_id: string;
  rank_eligible: boolean;
  eligibility_reasons?: string[];
};

type ReportManifest = {
  manifest_version: number;
  reports: ManifestEntry[];
};

export type Run = Report & {
  slug: string;
  manifest: ManifestEntry;
};

function contractSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function loadManifest(dataRoot: string): ReportManifest {
  const manifestPath = path.join(dataRoot, "report-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReportManifest;
  if (manifest.manifest_version !== 1 || !Array.isArray(manifest.reports)) {
    throw new Error(`unsupported report manifest: ${manifestPath}`);
  }
  return manifest;
}

export type CatalogTest = {
  name: string;
  profile: string;
  description: string;
};

/** One category the CLI can measure, as `providerbench list --json` prints it. */
export type CatalogCategory = {
  name: string;
  protocol?: string;
  tests: CatalogTest[];
};

let catalog: CatalogCategory[] | undefined;

/** What the CLI can measure, whether or not anyone has published a report. */
export function loadCatalog(): CatalogCategory[] {
  if (catalog) return catalog;
  const catalogPath = path.join(process.cwd(), "data", "catalog.json");
  const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as {
    catalog_version: number;
    categories: CatalogCategory[];
  };
  if (parsed.catalog_version !== 1 || !Array.isArray(parsed.categories)) {
    throw new Error(`unsupported test catalog: ${catalogPath}`);
  }
  catalog = parsed.categories;
  return catalog;
}

let runs: Run[] | undefined;

// Every page reads the dataset; a build worker verifies and parses it once.
export function loadRuns(): Run[] {
  runs ??= readRuns();
  return runs;
}

function readRuns(): Run[] {
  const dataRoot = path.join(process.cwd(), "data");
  const manifest = loadManifest(dataRoot);
  const resultsDir = path.join(dataRoot, "results");
  return manifest.reports
    .map((entry) => {
      if (path.basename(entry.file) !== entry.file || !entry.file.endsWith(".json")) {
        throw new Error(`unsafe report manifest path: ${entry.file}`);
      }
      const reportPath = path.join(resultsDir, entry.file);
      const raw = readFileSync(reportPath);
      const digest = createHash("sha256").update(raw).digest("hex");
      if (digest !== entry.sha256) {
        throw new Error(`report hash mismatch: ${entry.file}`);
      }
      const report = JSON.parse(raw.toString("utf8")) as Report;
      const category = report.category ?? "compute";
      const protocol =
        report.protocol_version ??
        contractSlug(`${category}-cli-${report.cli_version}`);
      const profile = report.profile ?? "standard";
      const cohort = report.measurement?.campaign_id ?? "";
      if (
        report.schema_version !== entry.schema_version ||
        category !== entry.category ||
        protocol !== entry.protocol_version ||
        profile !== entry.profile ||
        cohort !== entry.cohort_id
      ) {
        throw new Error(`report manifest metadata mismatch: ${entry.file}`);
      }
      return {
        ...report,
        slug: entry.file.replace(/\.json$/, ""),
        manifest: entry,
      };
    })
    .sort((a, b) => (a.provider.name ?? "").localeCompare(b.provider.name ?? ""));
}

export function runsByCategory(category: string): Run[] {
  return loadRuns().filter((r) => (r.category ?? "compute") === category);
}

export function runsForProvider(slug: string): Run[] {
  return loadRuns().filter((r) => r.provider.name === slug);
}

export function metricOf(run: Report, test: string, metric: string): Metric | undefined {
  return run.results
    .find((r) => r.test === test)
    ?.metrics.find((m) => m.name === metric);
}

export function allSample(runs: Report[]): boolean {
  return runs.length > 0 && runs.every((r) => r.sample);
}

export function anySample(runs: Report[]): boolean {
  return runs.some((r) => r.sample);
}
