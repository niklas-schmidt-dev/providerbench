import { SCORE_METRICS } from "@/lib/aggregate";

export const SUITE_LABELS: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  network: "Network",
  steal: "Consistency & steal",
};

/** Composite weights rolled up per suite, in percent, heaviest first. */
export const SCORE_WEIGHTS_BY_SUITE = [
  ...SCORE_METRICS.reduce((acc, m) => acc.set(m.test, (acc.get(m.test) ?? 0) + m.weight), new Map<string, number>()),
]
  .map(([suite, weight]) => ({ suite, label: SUITE_LABELS[suite] ?? suite, weight: Math.round(weight * 100) }))
  .sort((a, b) => b.weight - a.weight);
