import type * as React from "react";

import { getCompany, type CompanySlug } from "@/lib/companies";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
  xl: "size-10",
} as const;

const WORDMARK_SIZES = {
  xs: "h-3 w-12",
  sm: "h-3.5 w-14",
  md: "h-4 w-16",
  lg: "h-6 w-24",
  xl: "h-8 w-32",
} satisfies Record<keyof typeof SIZES, string>;

export type CompanyLogoSize = keyof typeof SIZES;

type CompanyLogoProps = Omit<React.ComponentProps<"span">, "children"> & {
  company: CompanySlug;
  size?: CompanyLogoSize;
  decorative?: boolean;
};

/**
 * A company mark drawn in the current text color. The SVG is used as a mask,
 * so every logo reads as one monochrome ink on both themes — brand colors
 * would compete with the data series.
 */
export function CompanyLogo({
  company: companySlug,
  size = "sm",
  decorative = false,
  className,
  style,
  ...props
}: CompanyLogoProps) {
  const company = getCompany(companySlug);
  const mask = `url(${company.logoPath}) center / contain no-repeat`;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${company.name} logo`}
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-block shrink-0 bg-current",
        company.logoKind === "wordmark" ? WORDMARK_SIZES[size] : SIZES[size],
        className,
      )}
      style={{ mask, WebkitMask: mask, ...style }}
      {...props}
    />
  );
}

type CompanyBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  company: CompanySlug;
  label?: string;
};

export function CompanyBadge({ company: companySlug, label, className, ...props }: CompanyBadgeProps) {
  const company = getCompany(companySlug);
  const visibleLabel = label ?? company.name;
  const wordmarkOnly = company.logoKind === "wordmark" && visibleLabel === company.name;
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-[13px] text-foreground",
        className,
      )}
      {...props}
    >
      <CompanyLogo company={companySlug} size="sm" decorative={!wordmarkOnly} />
      {wordmarkOnly ? null : visibleLabel}
    </span>
  );
}
