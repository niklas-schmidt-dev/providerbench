"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Building2, FileTerminal, LayoutDashboard, Search } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { CATEGORIES } from "@/lib/categories";
import { METRICS } from "@/lib/metrics";
import { PROVIDERS } from "@/lib/providers";

// Global ⌘K search over benchmarks, providers and pages.
export function CommandMenu({ providersWithRuns }: { providersWithRuns: string[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const withRuns = new Set(providersWithRuns);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:flex"
      >
        <Search className="size-3.5" />
        Search
        <kbd className="ml-3 rounded-sm border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground sm:hidden"
      >
        <Search className="size-3.5" />
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Benchmarks, providers, pages…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Benchmarks">
            {METRICS.map((m) => (
              <CommandItem
                key={`${m.test}.${m.metric}`}
                value={`${m.title} ${m.test} ${m.metric} ${m.unit}`}
                onSelect={() => go(`/${m.category}#${m.test}-${m.metric}`)}
              >
                <BarChart3 className="size-4" />
                <span>{m.title}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {m.unit}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Providers">
            {PROVIDERS.map((p) => (
              <CommandItem
                key={p.slug}
                value={`${p.name} provider`}
                disabled={!withRuns.has(p.slug)}
                onSelect={() => go(`/providers/${p.slug}`)}
              >
                <Building2 className="size-4" />
                <span>{p.name}</span>
                {!withRuns.has(p.slug) && (
                  <span className="ml-auto text-[11px] text-muted-foreground">awaiting data</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Pages">
            {[
              { label: "Dashboard", href: "/", icon: LayoutDashboard },
              ...CATEGORIES.map((c) => ({
                label: `${c.name} benchmarks`,
                href: `/${c.slug}`,
                icon: BarChart3,
              })),
              { label: "All providers", href: "/providers", icon: Building2 },
              { label: "CLI & contributing", href: "/cli", icon: FileTerminal },
            ].map((p) => (
              <CommandItem key={p.href} value={p.label} onSelect={() => go(p.href)}>
                <p.icon className="size-4" />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
