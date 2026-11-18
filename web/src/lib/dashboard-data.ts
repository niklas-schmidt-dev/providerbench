import { aggregateRuns, bestRegionPerPlan, currentScoredGroups } from "@/lib/aggregate";
import { getCategory } from "@/lib/categories";
import { anySample, runsByCategory } from "@/lib/data";
import { formatMeasurementDate } from "@/lib/dates";
import { sortPlans, toPlanDatum } from "@/lib/plans";
import { PROVIDERS } from "@/lib/providers";

/** Everything the category dashboard renders, computed once at build time. */
export function loadDashboard(categorySlug: string) {
  const category = getCategory(categorySlug);
  if (!category?.report) throw new Error(`category ${categorySlug} has no report spec`);
  const runs = runsByCategory(categorySlug);
  const current = currentScoredGroups(aggregateRuns(runs));
  const plans = sortPlans(
    bestRegionPerPlan(current).map(toPlanDatum),
    PROVIDERS.map((p) => p.slug),
  );
  const updated = runs.map((r) => r.created_at).sort().at(-1);
  return {
    category,
    report: category.report,
    plans,
    sample: anySample(runs),
    stats: {
      providers: new Set(plans.map((p) => p.provider)).size,
      plans: plans.length,
      hosts: current.reduce((sum, group) => sum + group.hostCount, 0),
      runs: runs.length,
      updated: updated ? formatMeasurementDate(updated) : "—",
    },
  };
}
