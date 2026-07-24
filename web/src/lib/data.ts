import { readdirSync, readFileSync } from "fs";
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
  error?: string;
};

export type Report = {
  schema_version: number;
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

export type Run = Report & { slug: string };

// Canonical data lives at the repo root in data/results. The prebuild step
// copies it to web/data so builds only read inside the app root; the ../
// fallback covers `next dev` without a prior build.
function dataDir(): string {
  for (const p of [
    path.join(process.cwd(), "data", "results"),
    path.join(process.cwd(), "..", "data", "results"),
  ]) {
    try {
      readdirSync(p);
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error("data/results directory not found");
}

export function loadRuns(): Run[] {
  const dir = dataDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const report = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Report;
      return { ...report, slug: f.replace(/\.json$/, "") };
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
