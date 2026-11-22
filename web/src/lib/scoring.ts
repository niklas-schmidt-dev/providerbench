import { SCORE_METRICS } from "@/lib/aggregate";
import { suiteDef } from "@/lib/metrics";

/** Composite weights of the compute score rolled up per suite, in percent, heaviest first. */
export const SCORE_WEIGHTS_BY_SUITE = [
  ...SCORE_METRICS.reduce((acc, m) => acc.set(m.test, (acc.get(m.test) ?? 0) + m.weight), new Map<string, number>()),
]
  .map(([suite, weight]) => ({ suite, label: suiteDef("compute", suite).label, weight: Math.round(weight * 100) }))
  .sort((a, b) => b.weight - a.weight);
