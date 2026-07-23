import type * as React from "react";

import {
  getCompany,
  type CompanyLogoKind,
  type CompanySlug,
} from "@/lib/companies";
import { cn } from "@/lib/utils";

const LOGO_SIZES = {
  xs: {
    mark: "size-6 rounded-md",
    wordmark: "h-6 w-[4.5rem] rounded-md",
  },
  sm: {
    mark: "size-8 rounded-lg",
    wordmark: "h-8 w-24 rounded-lg",
  },
  md: {
    mark: "size-11 rounded-xl",
    wordmark: "h-11 w-32 rounded-xl",
  },
  lg: {
    mark: "size-14 rounded-2xl",
    wordmark: "h-14 w-40 rounded-2xl",
  },
} as const;

export type CompanyLogoSize = keyof typeof LOGO_SIZES;

type CompanyLogoProps = Omit<React.ComponentProps<"span">, "children"> & {
  company: CompanySlug;
  size?: CompanyLogoSize;
  decorative?: boolean;
};

function sizeClass(size: CompanyLogoSize, kind: CompanyLogoKind) {
  return LOGO_SIZES[size][kind];
}

export function CompanyLogo({
  company: companySlug,
  size = "sm",
  decorative = false,
  className,
  ...props
}: CompanyLogoProps) {
  const company = getCompany(companySlug);
  const darkSurface = company.logoSurface === "dark";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
        darkSurface ? "border-white/10 bg-[#111318]" : "border-black/10 bg-[#f7f7f4]",
        sizeClass(size, company.logoKind),
        className,
      )}
      {...props}
    >
      {/* SVGs live in public assets so the same source can be reused by metadata and static pages. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={company.logoPath}
        alt={decorative ? "" : `${company.name} logo`}
        aria-hidden={decorative || undefined}
        className={cn(
          "block object-contain",
          company.logoKind === "wordmark" ? "h-[52%] w-[78%]" : "size-[68%]",
        )}
      />
    </span>
  );
}

type CompanyBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  company: CompanySlug;
  label?: string;
};

export function CompanyBadge({
  company: companySlug,
  label,
  className,
  ...props
}: CompanyBadgeProps) {
  const company = getCompany(companySlug);
  const visibleLabel = label ?? company.name;
  const wordmarkRepeatsLabel =
    company.logoKind === "wordmark" && visibleLabel === company.name;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border bg-card/50 py-1 pr-2.5 text-[12px] text-foreground/85",
        company.logoKind === "wordmark" ? "pl-1" : "pl-1.5",
        className,
      )}
      {...props}
    >
      <CompanyLogo company={companySlug} size="xs" decorative />
      {wordmarkRepeatsLabel ? (
        <span className="sr-only">{visibleLabel}</span>
      ) : (
        <span>{visibleLabel}</span>
      )}
    </span>
  );
}
