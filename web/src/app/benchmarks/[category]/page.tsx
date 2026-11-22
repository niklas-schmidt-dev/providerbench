import { RESERVED_SLUGS } from "@/lib/categories";
import { siteCategories } from "@/lib/site";

// A category named like a page of the site (cli, providers, benchmarks)
// cannot have that path. Its page lives here instead.
export { default, generateMetadata } from "@/app/[category]/page";

export const dynamicParams = false;

export function generateStaticParams() {
  return siteCategories()
    .filter((category) => RESERVED_SLUGS.includes(category.slug))
    .map((category) => ({ category: category.slug }));
}
