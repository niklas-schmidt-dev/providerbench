export function formatMetricValue(v: number): string {
  if (v >= 10000)
    return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
