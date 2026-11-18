// Provider registry. Categorical color follows the entity, never its rank:
// every provider owns a `--provider-<slug>` token in globals.css, defined once
// per theme and validated as one categorical palette. New providers add an
// entry here and a token pair there.
import type { CompanySlug } from "@/lib/companies";

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

export function getProvider(slug: string): ProviderMeta {
  return (
    bySlug.get(slug) ?? {
      // Community-submitted providers without a registered slot fold into a
      // neutral swatch until they get one — never a generated hue.
      slug,
      name: slug,
      color: swatch("other"),
      website: "",
      blurb: "",
    }
  );
}

export function providerColor(slug: string): string {
  return getProvider(slug).color;
}

export function providerLabel(slug: string): string {
  return getProvider(slug).name;
}
