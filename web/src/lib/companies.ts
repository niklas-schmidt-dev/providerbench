import logoManifest from "../../public/assets/logos/companies/manifest.json";

export const COMPANY_SLUGS = [
  "hetzner",
  "netcup",
  "ovh",
  "digitalocean",
  "aws",
  "vercel",
  "openai",
  "anthropic",
  "google",
  "groq",
  "together-ai",
  "fireworks-ai",
  "cloudflare",
  "backblaze",
  "tigris",
] as const;

export type CompanySlug = (typeof COMPANY_SLUGS)[number];
export type CompanyLogoKind = "mark" | "wordmark";
export type CompanyLogoSurface = "light" | "dark" | "any";

export type CompanyMeta = {
  slug: CompanySlug;
  name: string;
  labels: string[];
  logoPath: string;
  logoKind: CompanyLogoKind;
  logoSurface: CompanyLogoSurface;
};

const LOGO_KINDS = {
  hetzner: "mark",
  netcup: "mark",
  ovh: "mark",
  digitalocean: "mark",
  aws: "mark",
  vercel: "mark",
  openai: "wordmark",
  anthropic: "mark",
  google: "mark",
  groq: "mark",
  "together-ai": "mark",
  "fireworks-ai": "wordmark",
  cloudflare: "mark",
  backblaze: "mark",
  tigris: "wordmark",
} satisfies Record<CompanySlug, CompanyLogoKind>;

const knownSlugs = new Set<string>(COMPANY_SLUGS);

export const COMPANIES: CompanyMeta[] = logoManifest.companies.map((company) => {
  if (!knownSlugs.has(company.slug)) {
    throw new Error(`Unknown company slug in logo manifest: ${company.slug}`);
  }

  const slug = company.slug as CompanySlug;

  return {
    slug,
    name: company.name,
    labels: company.labels,
    logoPath: `${logoManifest.basePath}/${company.file}`,
    logoKind: LOGO_KINDS[slug],
    logoSurface: company.recommendedSurface as CompanyLogoSurface,
  };
});

const bySlug = new Map(COMPANIES.map((company) => [company.slug, company]));

export function getCompany(slug: CompanySlug): CompanyMeta {
  const company = bySlug.get(slug);

  if (!company) {
    throw new Error(`Missing company metadata for: ${slug}`);
  }

  return company;
}
