// What each benchmark metric measures. A report already carries a metric's
// name, unit and direction, so any metric renders without an entry here; the
// registry adds what a report cannot hold: a title and the workload behind the
// number. Keep the texts accurate to internal/tests/* — they describe the real
// implementation, not marketing.

import { humanize } from "@/lib/text";

export type MetricDef = {
  category: string;
  test: string;
  metric: string;
  title: string;
  unit: string;
  higherIsBetter: boolean;
  /** What concretely happens during the measurement. */
  workload: string;
  /** Optional interpretation aid shown under the chart. */
  note?: string;
};

export const METRICS: MetricDef[] = [
  {
    category: "compute",
    test: "cpu",
    metric: "single_core_hash",
    title: "CPU · single core",
    unit: "MB/s",
    higherIsBetter: true,
    workload:
      "SHA-256 over 64 KiB buffers on one core for 3 s. Cache-resident and deterministic; uses the CPU's crypto extensions where present.",
  },
  {
    category: "compute",
    test: "cpu",
    metric: "multi_core_hash",
    title: "CPU · all cores",
    unit: "MB/s",
    higherIsBetter: true,
    workload:
      "The same SHA-256 workload running on every core simultaneously for 3 s — what the machine sustains when you actually use all the vCPUs you pay for.",
  },
  {
    category: "compute",
    test: "cpu",
    metric: "scaling_efficiency",
    title: "CPU · scaling efficiency",
    unit: "%",
    higherIsBetter: true,
    workload:
      "All-cores throughput divided by single-core throughput × reported vCPU count. 100% means the workload scaled linearly across the available logical CPUs.",
    note: "Lower values can reflect shared-host contention, SMT, frequency changes, memory limits or benchmark overhead; they do not identify one cause by themselves.",
  },
  {
    category: "compute",
    test: "memory",
    metric: "copy_bandwidth",
    title: "Memory · copy bandwidth",
    unit: "GB/s",
    higherIsBetter: true,
    workload:
      "Copies between two 256 MiB buffers for 2 s — far beyond any CPU cache, so this is DRAM bandwidth, not cache tricks.",
  },
  {
    category: "compute",
    test: "memory",
    metric: "random_access_latency",
    title: "Memory · random access",
    unit: "ns",
    higherIsBetter: false,
    workload:
      "Pointer chase through a randomly permuted 64 MiB array (fixed seed). Every load depends on the previous one, so prefetching can't hide the true latency.",
  },
  {
    category: "compute",
    test: "disk",
    metric: "seq_write",
    title: "Disk · sequential write",
    unit: "MB/s",
    higherIsBetter: true,
    workload:
      "1 GiB written in 4 MiB blocks, each stamped unique to defeat compression and dedup, with a final fsync included in the time.",
  },
  {
    category: "compute",
    test: "disk",
    metric: "seq_read",
    title: "Disk · sequential read",
    unit: "MB/s",
    higherIsBetter: true,
    workload:
      "The same 1 GiB file read back in 4 MiB blocks with direct I/O — the page cache is bypassed, so this is the device, not RAM.",
  },
  {
    category: "compute",
    test: "disk",
    metric: "rand_read_4k",
    title: "Disk · random 4K read",
    unit: "IOPS",
    higherIsBetter: true,
    workload:
      "Random 4 KiB direct-I/O reads at queue depth 4 for 2 s across the 1 GiB file — the access pattern of databases and busy filesystems.",
  },
  {
    category: "compute",
    test: "disk",
    metric: "fsync_latency_p50",
    title: "Disk · fsync latency (p50)",
    unit: "ms",
    higherIsBetter: false,
    workload:
      "Median of 50 rounds of a 4 KiB write followed by fsync — the durability path every database commit waits on.",
    note: "Suspiciously low values can mean the storage acknowledges before data is durable.",
  },
  {
    category: "compute",
    test: "network",
    metric: "latency_p50",
    title: "Network · latency (p50)",
    unit: "ms",
    higherIsBetter: false,
    workload:
      "Median of 8 tiny requests on a warm connection to the nearest Cloudflare edge, minus the server processing time Cloudflare reports via its cfReq*/cfSpeed* Server-Timing metrics — effectively the round-trip time out of the datacenter.",
  },
  {
    category: "compute",
    test: "network",
    metric: "download",
    title: "Network · download",
    unit: "Mbps",
    higherIsBetter: true,
    workload:
      "Sequential 50 MiB downloads from speed.cloudflare.com for up to 10 s (200 MiB max), counted at the socket.",
  },
  {
    category: "compute",
    test: "network",
    metric: "upload",
    title: "Network · upload",
    unit: "Mbps",
    higherIsBetter: true,
    workload: "A 50 MiB POST to speed.cloudflare.com, timed end to end.",
  },
  {
    category: "compute",
    test: "steal",
    metric: "unit_time_p50",
    title: "Consistency · unit time (p50)",
    unit: "ms",
    higherIsBetter: false,
    workload:
      "Median runtime of 400 calibrated, identical hashing work units. The absolute value is a supporting latency measure for the distribution-based consistency signals.",
  },
  {
    category: "compute",
    test: "steal",
    metric: "consistency_cv",
    title: "Consistency · variation",
    unit: "CV %",
    higherIsBetter: false,
    workload:
      "400 identical ~20 ms hashing units back to back; this is the coefficient of variation of their runtimes. On honest hardware, identical work takes identical time.",
    note: "High spread = noisy neighbors or burst throttling.",
  },
  {
    category: "compute",
    test: "steal",
    metric: "p99_over_p50",
    title: "Tail latency · p99 / median",
    unit: "ratio",
    higherIsBetter: false,
    workload:
      "How much slower the worst 1% of those 400 identical units ran compared to the median. 1.0 is perfect.",
    note: "A high ratio is a tail-latency signal. It can indicate contention, throttling, scheduling pauses or other transient effects; it does not prove a CPU-credit cliff.",
  },
  {
    category: "compute",
    test: "steal",
    metric: "cpu_steal",
    title: "CPU steal time",
    unit: "%",
    higherIsBetter: false,
    workload:
      "Steal ticks from /proc/stat while all cores are saturated for 5 s — the kernel's own record of CPU time the hypervisor gave to other tenants.",
    note: "Linux only. Interpret the measured percentage together with consistency and repeated campaigns; no universal threshold proves overselling.",
  },
];

export function getMetricDef(category: string, test: string, metric: string): MetricDef | undefined {
  return METRICS.find((m) => m.category === category && m.test === test && m.metric === metric);
}

/** Presentation of one test (a "suite" on the dashboard) beyond its name. */
type SuiteDef = {
  /** Section title. */
  label: string;
  /** Shorter name for the view tabs. */
  tab?: string;
  /** Metric shown first. */
  defaultMetric?: string;
  /** What the test does. Default: the description the CLI gives it. */
  summary?: string;
};

const SUITES: Record<string, SuiteDef> = {
  "compute/cpu": {
    label: "CPU",
    defaultMetric: "multi_core_hash",
    summary:
      "Deterministic SHA-256 hashing — same bytes on every machine; differences are the silicon and the hypervisor.",
  },
  "compute/memory": {
    label: "Memory",
    summary: "Big-buffer copies and a prefetch-proof pointer chase with a fixed random seed.",
  },
  "compute/disk": {
    label: "Disk",
    defaultMetric: "rand_read_4k",
    summary: "1 GiB test file with unique-stamped blocks; reads bypass the page cache via direct I/O.",
  },
  "compute/network": {
    label: "Network",
    defaultMetric: "download",
    summary: "Timed transfers against speed.cloudflare.com — the nearest neutral edge, no hand-picked peering.",
  },
  "compute/steal": {
    label: "Consistency & steal",
    tab: "Consistency",
    defaultMetric: "consistency_cv",
    summary:
      "Identical work units plus /proc/stat steal ticks — signals for contention, throttling and run-to-run consistency.",
  },
};

export function suiteDef(category: string, test: string): SuiteDef {
  return SUITES[`${category}/${test}`] ?? { label: humanize(test) };
}

/** A metric ready to render: registry texts where they exist, the report's own facts otherwise. */
export type MetricInfo = {
  category: string;
  test: string;
  metric: string;
  /** Full title, e.g. "CPU · single core". */
  title: string;
  /** Short label inside its suite, e.g. "Single core". */
  label: string;
  unit: string;
  higherIsBetter: boolean;
  workload?: string;
  note?: string;
};

/**
 * Describe a metric found in a report. `measured` is what the report says
 * about it; `label` overrides the short label (a category can name its
 * variants, e.g. "English" for accuracy_en).
 */
export function describeMetric(
  category: string,
  test: string,
  metric: string,
  measured: { unit: string; higherIsBetter: boolean },
  label?: string,
): MetricInfo {
  const def = getMetricDef(category, test, metric);
  if (def) {
    const tail = def.title.split(" · ")[1] ?? def.title;
    return {
      category,
      test,
      metric,
      title: def.title,
      label: label ?? tail.charAt(0).toUpperCase() + tail.slice(1),
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      workload: def.workload,
      note: def.note,
    };
  }
  const short = label ?? humanize(metric);
  return {
    category,
    test,
    metric,
    title: `${suiteDef(category, test).label} · ${short}`,
    label: short,
    unit: measured.unit,
    higherIsBetter: measured.higherIsBetter,
  };
}
