// Single source of truth for what each benchmark metric actually measures.
// Charts render these descriptions so a number is never shown without its
// workload. Keep the texts accurate to internal/tests/* — they describe the
// real implementation, not marketing.

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

export const TEST_SUMMARIES: Record<string, string> = {
  cpu: "Deterministic SHA-256 hashing — same bytes on every machine; differences are the silicon and the hypervisor.",
  memory: "Big-buffer copies and a prefetch-proof pointer chase with a fixed random seed.",
  disk: "1 GiB test file with unique-stamped blocks; reads bypass the page cache via direct I/O.",
  network: "Timed transfers against speed.cloudflare.com — the nearest neutral edge, no hand-picked peering.",
  steal: "Identical work units plus /proc/stat steal ticks — overselling shows up as variance and stolen time.",
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
      "All-cores throughput divided by single-core × core count. 100% = every vCPU is a real, un-shared core.",
    note: "Collapses when 'cores' are time slices of somebody else's workload.",
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
      "Median of 8 tiny requests on a warm connection to the nearest Cloudflare edge — effectively the round-trip time out of the datacenter.",
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
    note: "Burstable instances show their credit cliff here.",
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
    note: "Above ~2% sustained is an oversold host. Linux only.",
  },
];

export function getMetricDef(test: string, metric: string): MetricDef | undefined {
  return METRICS.find((m) => m.test === test && m.metric === metric);
}
