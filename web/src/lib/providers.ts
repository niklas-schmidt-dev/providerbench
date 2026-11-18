// Provider registry. Categorical color follows the entity, never its rank —
// slots map onto the design system's categorical series palette (--series-*),
// chosen for legibility on white at 2px stroke and 8px bar width.
// New providers: add an entry with the next free slot color.
import type { CompanySlug } from "@/lib/companies";

const SLOTS = ["#2b6cb0", "#b6741a", "#0f6e63", "#5f7a11", "#8e4585", "#4d5459"];

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
    color: SLOTS[0],
    website: "https://www.hetzner.com",
    blurb: "German cloud & dedicated hosting, famously aggressive price/performance.",
  },
  {
    slug: "netcup",
    company: "netcup",
    name: "Netcup",
    color: SLOTS[1],
    website: "https://www.netcup.com",
    blurb: "Budget German VPS and root servers with generous specs on paper.",
  },
  {
    slug: "ovh",
    company: "ovh",
    name: "OVH",
    color: SLOTS[2],
    website: "https://www.ovhcloud.com",
    blurb: "Europe's largest hosting provider, VPS through bare metal.",
  },
  {
    slug: "digitalocean",
    company: "digitalocean",
    name: "DigitalOcean",
    color: SLOTS[3],
    website: "https://www.digitalocean.com",
    blurb: "Developer-focused cloud with simple droplets and predictable pricing.",
  },
  {
    slug: "aws",
    company: "aws",
    name: "AWS",
    color: SLOTS[4],
    website: "https://aws.amazon.com",
    blurb: "EC2 — the default. Burstable instances make benchmarking interesting.",
  },
  {
    slug: "vercel",
    company: "vercel",
    name: "Vercel",
    color: SLOTS[5],
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
      color: "#9aa3a8",
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
