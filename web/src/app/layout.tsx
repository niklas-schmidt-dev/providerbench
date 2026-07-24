import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";

import { CommandMenu } from "@/components/command-menu";
import { buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadRuns } from "@/lib/data";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://providerbench.dev"),
  title: {
    default: "ProviderBench — cloud provider benchmarks",
    template: "%s · ProviderBench",
  },
  description:
    "Independent, reproducible benchmarks for cloud providers: compute today, AI inference and object storage next. Open data, open method, no affiliate links.",
};

const nav = [
  { href: "/compute", label: "Compute" },
  { href: "/ai", label: "AI" },
  { href: "/storage", label: "Storage" },
  { href: "/providers", label: "Providers" },
  { href: "/cli", label: "CLI" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const providersWithRuns = [
    ...new Set(loadRuns().flatMap((r) => (r.provider.name ? [r.provider.name] : []))),
  ];
  return (
    <html lang="en" className={`dark ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen">
        <TooltipProvider>
          <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
            <div className="mx-auto flex h-13 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-[14px] font-semibold tracking-tight text-foreground">
                  ProviderBench
                </Link>
                <nav className="hidden items-center gap-4 md:flex">
                  {nav.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-2">
                <CommandMenu providersWithRuns={providersWithRuns} />
                <a
                  href="https://github.com/niklas-schmidt-dev/providerbench"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  GitHub
                </a>
                <Link href="/cli" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Run the benchmark
                </Link>
              </div>
            </div>
          </header>

          {children}

          <footer className="mt-20 border-t">
            <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-4 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:px-6">
              <p>
                ProviderBench — open data, open method.{" "}
                <a
                  className="text-foreground/80 hover:text-foreground"
                  href="https://github.com/niklas-schmidt-dev/providerbench"
                >
                  MIT licensed
                </a>
              </p>
              <p>
                No affiliate links, no sponsored rankings.{" "}
                <a
                  href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests"
                  className="text-brand hover:underline"
                >
                  Read the benchmark code
                </a>
              </p>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
