import type { Metadata } from "next";
import * as motion from "motion/react-client";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How ProviderBench measures CPU, memory, disk, network and overselling — and the rules that keep the comparison fair.",
};

const tests = [
  {
    id: "cpu",
    name: "cpu",
    label: "Compute throughput",
    what: "SHA-256 hashing over 64 KiB buffers, single-core and across all cores.",
    why: "Hashing exercises the ALU, cache and the CPU's crypto extensions in one deterministic number, with no memory or I/O noise. All-cores divided by (single-core × core count) yields scaling efficiency — on oversold hosts it collapses, because the 'cores' you rent are time slices of somebody else's.",
    metrics: ["single_core_hash MB/s", "multi_core_hash MB/s", "scaling_efficiency %"],
  },
  {
    id: "memory",
    name: "memory",
    label: "Bandwidth & latency",
    what: "Sequential copies between 256 MiB buffers, then a pointer chase through a randomly permuted 64 MiB array (fixed seed — identical pattern on every machine).",
    why: "The copy measures bandwidth well beyond any CPU cache. The pointer chase defeats prefetching entirely — every load depends on the previous one — revealing true memory latency.",
    metrics: ["copy_bandwidth GB/s", "random_access_latency ns"],
  },
  {
    id: "disk",
    name: "disk",
    label: "Throughput, IOPS & fsync",
    what: "A 1 GiB test file: sequential write (fsync included), sequential read with direct I/O, random 4K reads at queue depth 4, and 50 rounds of small-write-plus-fsync.",
    why: "Reads bypass the page cache (O_DIRECT on Linux) so we measure the device, not RAM. Write blocks are stamped unique to defeat compression and dedup tricks. fsync latency is the number your database commit actually waits on.",
    metrics: ["seq_write MB/s", "seq_read MB/s", "rand_read_4k IOPS", "fsync_latency_p50 ms"],
  },
  {
    id: "network",
    name: "network",
    label: "Latency & throughput",
    what: "Small requests on a warm connection for latency, then a 200 MiB download and 50 MiB upload against speed.cloudflare.com.",
    why: "Cloudflare's edge is the closest thing to a neutral, globally consistent endpoint — every provider's datacenter is a few milliseconds from one. It measures the pipe you get, not a hand-picked peering partner.",
    metrics: ["latency_p50 ms", "download Mbps", "upload Mbps"],
  },
  {
    id: "steal",
    name: "steal",
    label: "The overselling detector",
    what: "400 identical CPU work units back to back, then all cores saturated for 5 seconds while reading hypervisor steal time from /proc/stat.",
    why: "On honest hardware, identical work takes identical time — variance is other people's workloads leaking into yours. consistency_cv catches noisy neighbors, p99_over_p50 catches burst-credit cliffs, and cpu_steal is the kernel telling you directly that your CPU time went to someone else.",
    metrics: ["unit_time_p50 ms", "consistency_cv %", "p99_over_p50 ratio", "cpu_steal %"],
  },
];

const rules = [
  ["Deterministic workloads", "Fixed seeds everywhere: every machine runs bit-identical work, so differences are the hardware, never the benchmark."],
  ["No cache theater", "Disk reads use direct I/O; write blocks are stamped unique. If a number can be faked by caching, we bypass the cache."],
  ["Databases don't lie", "fsync is included in write timing and measured on its own. Storage that acknowledges before durability shows up here."],
  ["The kernel is a witness", "Steal time comes from /proc/stat — the hypervisor's own confession, not an inference."],
  ["Reproducible by anyone", "One static Go binary, zero dependencies, open source. Every report carries the exact CLI version and full system info."],
  ["No money in the loop", "No affiliate links, no sponsored placements. Nothing to gain from any provider winning."],
];

const caveats = [
  "A benchmark is a moment in time. A quiet host today can be oversold next month — which is exactly why the CLI is public and runs take ~90 seconds.",
  "Network numbers measure the path to the nearest Cloudflare edge — the fairest single reference point, but not your users' path.",
  "Burstable plans (AWS t-series and friends) can look great in short runs. The tail-latency ratio is designed to catch this; long sustained workloads diverge further.",
  "CPU steal time requires /proc/stat — on non-Linux hosts that metric is absent, not zero.",
];

export default function Methodology() {
  return (
    <main>
      <PageHeader
        eyebrow="Methodology"
        title="A benchmark is only as good as its excuses are few"
        lede="Five tests, each designed so the number can't be gamed by caching, bursting or marketing — and each small enough to audit in one sitting."
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mt-12 grid gap-4">
          {tests.map((t, i) => (
            <motion.div
              key={t.id}
              id={t.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.04 }}
            >
              <Card className="gap-3">
                <CardHeader className="flex flex-wrap items-center gap-3">
                  <Badge variant="secondary" className="font-mono">{t.name}</Badge>
                  <CardTitle className="text-base">{t.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/90">{t.what}</p>
                  <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                    {t.why}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {t.metrics.map((m) => (
                      <span
                        key={m}
                        className="rounded-md border bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <h2 className="mt-16 text-lg font-semibold text-foreground">
          Rules of the game
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map(([title, body]) => (
            <Card key={title} className="gap-2 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-sm">{title}</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <h2 className="mt-16 text-lg font-semibold text-foreground">
          Honest caveats
        </h2>
        <ul className="mt-6 max-w-3xl space-y-3">
          {caveats.map((c) => (
            <li key={c} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
              {c}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
