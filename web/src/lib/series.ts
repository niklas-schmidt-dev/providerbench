import { metricOf, type Run } from "@/lib/data";
import { providerLabel } from "@/lib/providers";

// One bar = one run (a provider's product/plan), not one provider — a
// provider can field any number of configurations in the same benchmark.
export type BarDatum = {
  id: string; // unique per run (report slug)
  provider: string; // company slug — chart color follows this entity
  label: string; // provider name, plus plan when needed to disambiguate
  product?: string;
  plan?: string;
  value: number;
  sample?: boolean;
};

export function metricSeries(runs: Run[], test: string, metric: string): BarDatum[] {
  const perProvider = new Map<string, number>();
  for (const r of runs) {
    if (r.provider.name) {
      perProvider.set(r.provider.name, (perProvider.get(r.provider.name) ?? 0) + 1);
    }
  }
  return runs.flatMap((r) => {
    const m = metricOf(r, test, metric);
    const name = r.provider.name;
    if (!m || !name) return [];
    const ambiguous = (perProvider.get(name) ?? 0) > 1;
    return [
      {
        id: r.slug,
        provider: name,
        label:
          ambiguous && r.provider.plan
            ? `${providerLabel(name)} ${r.provider.plan}`
            : providerLabel(name),
        product: r.provider.product,
        plan: r.provider.plan,
        value: m.value,
        sample: r.sample,
      },
    ];
  });
}
