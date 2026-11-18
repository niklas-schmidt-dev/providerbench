"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; muted?: boolean };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname === "/compute" : pathname.startsWith(href);
}

export function SiteNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("flex items-center gap-5", className)}>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 text-[13px] whitespace-nowrap transition-colors",
              active ? "text-foreground" : "text-subtle hover:text-foreground",
            )}
          >
            {item.label}
            {item.muted && <span className="ml-1 text-[11px] text-faint">soon</span>}
          </Link>
        );
      })}
    </nav>
  );
}
