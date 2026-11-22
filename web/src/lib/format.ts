export function formatMetricValue(v: number): string {
  if (v >= 10000)
    return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * One precision for a whole column or table, so its numbers line up: none
 * for whole numbers and large values, more the smaller the values get.
 */
export function uniformFormat(values: number[]): (value: number) => string {
  const smallest = Math.min(...values.map(Math.abs));
  const decimals = values.every(Number.isInteger) || smallest >= 100 ? 0 : smallest >= 10 ? 1 : 2;
  return (value) =>
    value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Hetzner's own naming treats "dedicated" as a property of the vCPU
// ("2 dedicated vCPU"), so that tier folds into the CPU phrase instead of
// appearing as a separate tag beside it.
export function planCpuParts(
  tier: string | undefined,
  cpuCores: number,
): { tier?: string; cpu: string } {
  const dedicated = tier === "dedicated";
  return {
    tier: dedicated ? undefined : tier,
    cpu: `${cpuCores}${dedicated ? " dedicated" : ""} vCPU`,
  };
}
