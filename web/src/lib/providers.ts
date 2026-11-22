// Provider registry. Categorical color follows the entity, never its rank:
// every provider owns a `--provider-<slug>` token in globals.css, defined once
// per theme and validated as one categorical palette. New providers add an
// entry here and a token pair there.
import { COMPANIES, type CompanySlug } from "@/lib/companies";
import { humanize } from "@/lib/text";

const swatch = (slug: string) => `var(--provider-${slug})`;

export type ProviderMeta = {
  slug: string;
  company?: CompanySlug;
  name: string;
  color: string;
  website: string;
  blurb: string;
};

type RegisteredProviderMeta = ProviderMeta & {
  company: CompanySlug;
};

export const PROVIDERS: RegisteredProviderMeta[] = [
  {
    slug: "hetzner",
    company: "hetzner",
    name: "Hetzner",
    color: swatch("hetzner"),
    website: "https://www.hetzner.com",
    blurb: "German cloud & dedicated hosting, famously aggressive price/performance.",
  },
  {
    slug: "netcup",
    company: "netcup",
    name: "Netcup",
    color: swatch("netcup"),
    website: "https://www.netcup.com",
    blurb: "Budget German VPS and root servers with generous specs on paper.",
  },
  {
    slug: "ovh",
    company: "ovh",
    name: "OVH",
    color: swatch("ovh"),
    website: "https://www.ovhcloud.com",
    blurb: "Europe's largest hosting provider, VPS through bare metal.",
  },
  {
    slug: "digitalocean",
    company: "digitalocean",
    name: "DigitalOcean",
    color: swatch("digitalocean"),
    website: "https://www.digitalocean.com",
    blurb: "Developer-focused cloud with simple droplets and predictable pricing.",
  },
  {
    slug: "aws",
    company: "aws",
    name: "AWS",
    color: swatch("aws"),
    website: "https://aws.amazon.com",
    blurb: "EC2 — the default. Burstable instances make benchmarking interesting.",
  },
  {
    slug: "vercel",
    company: "vercel",
    name: "Vercel",
    color: swatch("vercel"),
    website: "https://vercel.com",
    blurb: "Frontend cloud; measured here via Sandbox, its ephemeral microVM compute.",
  },
];

const bySlug = new Map(PROVIDERS.map((p) => [p.slug, p]));
const companies = new Map<string, (typeof COMPANIES)[number]>(COMPANIES.map((company) => [company.slug, company]));

export function getProvider(slug: string): ProviderMeta {
  const registered = bySlug.get(slug);
  if (registered) return registered;
  // A provider that appears in a report without a registry entry still gets a
  // name, and a logo where the company is known. Its color is assigned per
  // page by providerColors.
  const company = companies.get(slug);
  return {
    slug,
    company: company?.slug,
    name: company?.name ?? humanize(slug),
    color: swatch("other"),
    website: "",
    blurb: "",
  };
}

export function providerLabel(slug: string): string {
  return getProvider(slug).name;
}

// The palette's hues, as the tokens of the registered providers that own
// them. This order passes the dataviz validator in both themes (lightness
// band, chroma floor, separation of neighbours for color-blind readers).
// Vercel's ink is not a hue and stays with Vercel.
const PALETTE = ["digitalocean", "hetzner", "netcup", "aws", "ovh"];

/**
 * Series colors for the providers that share a page. A registered provider
 * keeps its own hue. The others take the palette slots no provider on the
 * page owns, in name order, so a color follows the provider and never its rank
 * or the current filter. Past the palette they share the neutral swatch,
 * never a generated hue.
 */
export function providerColors(slugs: Iterable<string>): Map<string, string> {
  const present = [...new Set(slugs)];
  const colors = new Map<string, string>();
  for (const slug of present) {
    if (bySlug.has(slug)) colors.set(slug, swatch(slug));
  }
  const free = PALETTE.filter((owner) => !colors.has(owner));
  present
    .filter((slug) => !bySlug.has(slug))
    .sort()
    .forEach((slug, index) => colors.set(slug, swatch(free[index] ?? "other")));
  return colors;
}
