import { CompanyLogo } from "@/components/company-logo";
import type { CompanySlug } from "@/lib/companies";

// Provider identity: the real logo chip where we have one, otherwise a
// mono initial tile in the provider's assigned series color. Identity never
// rides on color alone — the wordmark always accompanies the swatch.
export function ProviderMark({
  name,
  color,
  company,
  meta,
  size = "md",
}: {
  name: string;
  color: string;
  company?: CompanySlug;
  meta?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? 18 : size === "lg" ? 32 : 24;
  return (
    <span
      className="inline-flex min-w-0 shrink-0 items-center"
      style={{ gap: size === "lg" ? 10 : 8 }}
    >
      {company ? (
        <CompanyLogo
          company={company}
          size={size === "lg" ? "sm" : "xs"}
          decorative
        />
      ) : (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center rounded-(--radius-xs) font-mono font-medium tracking-[-0.02em] text-white"
          style={{
            width: dim,
            height: dim,
            background: color,
            fontSize: size === "sm" ? 10 : size === "lg" ? 15 : 12,
          }}
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: color }}
          />
          <span
            className="truncate font-medium tracking-[-0.01em] text-foreground"
            style={{ fontSize: size === "lg" ? 15 : 14 }}
          >
            {name}
          </span>
        </span>
        {meta && (
          <span className="block truncate text-[12px] leading-[15px] text-muted-foreground">
            {meta}
          </span>
        )}
      </span>
    </span>
  );
}
