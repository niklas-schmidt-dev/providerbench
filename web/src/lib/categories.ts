import type { LucideIcon } from "lucide-react";
import { Cpu, Database, Sparkles } from "lucide-react";

export type CategoryStatus = "live" | "planned";

export type Category = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: CategoryStatus;
  icon: LucideIcon;
  /** Headline metrics this category measures (or will). */
  metrics: string[];
  /** For planned categories: providers on the roadmap. */
  plannedProviders?: string[];
};

// Adding a category = adding an entry here plus result files with a matching
// `category` field in data/results/. Pages, nav and provider views pick it up.
export const CATEGORIES: Category[] = [
  {
    slug: "compute",
    name: "Compute",
    tagline: "VPS & dedicated servers",
    description:
      "CPU, memory, disk and network performance — plus steal time, run-to-run variance and the other overselling signals hiding behind the spec sheet.",
    status: "live",
    icon: Cpu,
    metrics: [
      "CPU single/all-core",
      "Memory bandwidth & latency",
      "Disk IOPS & fsync",
      "Network throughput",
      "CPU steal & consistency",
    ],
  },
  {
    slug: "ai",
    name: "AI Inference",
    tagline: "LLM APIs & serving platforms",
    description:
      "Time to first token, streaming throughput, cold starts and tail latency across AI inference providers — measured continuously, not quoted from launch blogs.",
    status: "planned",
    icon: Sparkles,
    metrics: [
      "Time to first token",
      "Tokens per second",
      "p99 request latency",
      "Cold start time",
      "Price per 1M tokens",
    ],
    plannedProviders: ["OpenAI", "Anthropic", "Google", "Groq", "Together", "Fireworks"],
  },
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
    plannedProviders: ["Cloudflare R2", "AWS S3", "Backblaze B2", "Google Cloud Storage", "Tigris"],
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
