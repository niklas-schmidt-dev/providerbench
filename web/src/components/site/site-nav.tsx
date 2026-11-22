"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  /** Other paths this item stands for. */
  also?: string[];
};

function isActive(pathname: string, item: NavItem) {
  if (item.also?.includes(pathname)) return true;
  if (item.href === "/") return pathname === "/" || pathname === "/compute";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SiteNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("flex items-center gap-5", className)}>
      {items.map((item) => {
        const active = isActive(pathname, item);
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
          </Link>
        );
      })}
    </nav>
  );
}
