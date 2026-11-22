import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/dm-sans/index.css";
import "@fontsource-variable/geist-mono/index.css";

import { SiteNav, type NavItem } from "@/components/site/site-nav";
import { SiteSearch } from "@/components/site/site-search";
import { THEME_SCRIPT, ThemeToggle } from "@/components/site/theme-toggle";
import { RAW_DATA_URL } from "@/lib/plans";
import { buildSearchIndex } from "@/lib/search-index";
import { siteCategories } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://providerbench.dev"),
  title: {
    default: "ProviderBench — cloud provider benchmarks",
    template: "%s · ProviderBench",
  },
  description:
    "Independent, reproducible benchmarks for cloud providers: compute today, more categories as their first reports land. Open data, open method, no affiliate links.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

const REPO = "https://github.com/niklas-schmidt-dev/providerbench";

// Categories with published reports get a place in the navigation; the
// rest are one click away under "All benchmarks".
function navItems(): NavItem[] {
  const categories = siteCategories();
  return [
    ...categories.filter((c) => c.live).map((c) => ({ href: c.href, label: c.name })),
    {
      href: "/benchmarks",
      label: "All benchmarks",
      also: categories.filter((c) => !c.live).map((c) => c.href),
    },
    { href: "/providers", label: "Providers" },
    { href: "/cli", label: "CLI" },
  ];
}

function Wordmark() {
  return (
    <Link href="/" aria-label="ProviderBench home" className="shrink-0 text-[20px] leading-none font-[450] tracking-[-0.05em]">
      <span className="text-subtle">provider</span>
      <span>bench</span>
    </Link>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nav = navItems();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
          <header className="sticky top-0 z-40 border-b border-border bg-background">
            <div className="flex h-14 items-center gap-8 px-4 sm:px-7">
              <Wordmark />
              <SiteNav items={nav} className="hidden md:flex" />
              <div className="flex-1" />
              <div className="flex items-center gap-1.5">
                <SiteSearch entries={buildSearchIndex()} />
                <ThemeToggle />
                <a
                  href={REPO}
                  aria-label="ProviderBench on GitHub"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                >
                  <GitHubIcon />
                </a>
              </div>
            </div>
            <SiteNav items={nav} className="no-scrollbar h-10 overflow-x-auto border-t border-border px-4 md:hidden" />
          </header>

          <div className="flex-1">{children}</div>

          <footer className="border-t border-border">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-[12px] text-subtle sm:px-7">
              <p>
                Open data · open method · no affiliate links ·{" "}
                <a href={`${REPO}/blob/main/LICENSE`} className="text-muted-foreground transition-colors hover:text-foreground">
                  MIT
                </a>
              </p>
              <nav aria-label="Project" className="flex flex-wrap gap-x-5 gap-y-1">
                <a href={RAW_DATA_URL} className="transition-colors hover:text-foreground">
                  Raw data
                </a>
                <a href={`${REPO}/tree/main/internal/tests`} className="transition-colors hover:text-foreground">
                  Benchmark source
                </a>
                <a href={`${REPO}/issues`} className="transition-colors hover:text-foreground">
                  Discuss
                </a>
              </nav>
            </div>
          </footer>
      </body>
    </html>
  );
}
