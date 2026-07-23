// Provider registry. Categorical color follows the entity, never its rank —
// the slot order is the validated CVD-safe ordering, do not re-shuffle.
// New providers: add an entry with the next free slot color.
import type { CompanySlug } from "@/lib/companies";

const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];

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
    slug: "vercel-sandbox",
    company: "vercel",
    name: "Vercel Sandbox",
    color: SLOTS[5],
    website: "https://vercel.com/docs/vercel-sandbox",
    blurb: "Ephemeral microVM compute for untrusted code execution.",
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
      color: "#898781",
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
