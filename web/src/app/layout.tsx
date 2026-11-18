import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/geist-sans/latin-400.css";
import "@fontsource/geist-sans/latin-500.css";
import "@fontsource/geist-sans/latin-600.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";

import { CommandMenu } from "@/components/command-menu";
import { buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CATEGORIES } from "@/lib/categories";
import { loadRuns } from "@/lib/data";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://providerbench.dev"),
  title: {
    default: "ProviderBench — cloud provider benchmarks",
    template: "%s · ProviderBench",
  },
  description:
    "Independent, reproducible benchmarks for cloud providers: compute today, object storage next. Open data, open method, no affiliate links.",
};

const nav = [
  { href: "/compute", label: "Compute" },
  { href: "/storage", label: "Storage" },
  { href: "/providers", label: "Providers" },
  { href: "/cli", label: "CLI" },
];

// The mark: a mono "P" tile — graphite plate, instrument-lime glyph.
function BenchMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-[22px] items-center justify-center rounded-[4px] bg-gray-950 font-mono text-[13px] font-semibold text-signal",
        className,
      )}
    >
      P
    </span>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const providersWithRuns = [
    ...new Set(loadRuns().flatMap((r) => (r.provider.name ? [r.provider.name] : []))),
  ];
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <TooltipProvider>
          <header className="sticky top-0 z-40 border-b border-(--border-hairline) bg-card">
            <div className="mx-auto flex h-[58px] max-w-(--content-max) items-center gap-6 px-4 sm:px-8">
              <Link href="/" className="flex shrink-0 items-center gap-[9px]">
                <BenchMark />
                <span className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">
                  ProviderBench
                </span>
              </Link>
              <nav className="hidden items-center gap-5 md:flex">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="text-[14px] tracking-[-0.005em] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="min-w-2 flex-1" />
              <div className="flex items-center gap-2.5">
                <CommandMenu providersWithRuns={providersWithRuns} />
                <a
                  href="https://github.com/niklas-schmidt-dev/providerbench"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "hidden text-[13px] sm:inline-flex",
                  )}
                >
                  GitHub
                </a>
                <Link
                  href="/cli"
                  className={cn(
                    buttonVariants({ variant: "default", size: "sm" }),
                    "text-[13px]",
                  )}
                >
                  Run the benchmark
                </Link>
              </div>
            </div>
          </header>

          <div className="flex-1">{children}</div>

          <footer className="hero-dark mt-24">
            <div className="mx-auto grid max-w-(--content-max) grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-9 px-4 py-11 sm:px-8">
              <div>
                <span className="flex items-center gap-[9px]">
                  <BenchMark className="size-[18px] bg-gray-900 text-[11px]" />
                  <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-0">
                    ProviderBench
                  </span>
                </span>
                <p className="mt-2 max-w-[250px] text-[12.5px] leading-[19px] text-gray-500">
                  Independent, reproducible cloud benchmarks. No vendor
                  sponsorships, no affiliate links —{" "}
                  <a
                    href="https://github.com/niklas-schmidt-dev/providerbench"
                    className="border-b border-gray-700 text-gray-400 hover:text-gray-0"
                  >
                    MIT licensed
                  </a>
                  .
                </p>
              </div>
              <div>
                <div className="pb-label mb-2.5 text-[10.5px] text-gray-600">
                  Benchmarks
                </div>
                <div className="grid justify-items-start gap-[7px]">
                  {CATEGORIES.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/${c.slug}`}
                      className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                    >
                      {c.name}
                      {c.status === "planned" && (
                        <span className="ml-1.5 text-[11px] text-gray-600">planned</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <div className="pb-label mb-2.5 text-[10.5px] text-gray-600">
                  Providers
                </div>
                <div className="grid justify-items-start gap-[7px]">
                  {PROVIDERS.slice(0, 4).map((p) => (
                    <Link
                      key={p.slug}
                      href={`/providers/${p.slug}`}
                      className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                    >
                      {p.name}
                    </Link>
                  ))}
                  <Link
                    href="/providers"
                    className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                  >
                    All providers
                  </Link>
                </div>
              </div>
              <div>
                <div className="pb-label mb-2.5 text-[10.5px] text-gray-600">
                  Project
                </div>
                <div className="grid justify-items-start gap-[7px]">
                  <Link
                    href="/cli"
                    className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                  >
                    CLI &amp; methodology
                  </Link>
                  <a
                    href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests"
                    className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                  >
                    Benchmark source
                  </a>
                  <a
                    href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results"
                    className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                  >
                    Raw data downloads
                  </a>
                  <a
                    href="https://github.com/niklas-schmidt-dev/providerbench/issues"
                    className="text-[13px] text-gray-400 transition-colors hover:text-gray-0"
                  >
                    Open a discussion
                  </a>
                </div>
              </div>
            </div>
            <div className="border-t border-(--border-inverse)">
              <div className="mx-auto flex max-w-(--content-max) flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-8">
                <span className="pb-label text-[10px] text-gray-600">
                  Open data · Open method
                </span>
                <span className="pb-label text-[10px] text-gray-600">
                  No affiliate links · No sponsored rankings
                </span>
              </div>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
