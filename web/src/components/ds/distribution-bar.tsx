// Percentile spread on a shared scale: band across the middle of the
// distribution, strong tick at the median, ink whisker at the p99 tail.
export function DistributionBar({
  p50,
  bandLo,
  bandHi,
  p99,
  domainMax,
  color = "var(--series-6)",
  unit = "",
  showScale,
}: {
  p50: number;
  /** Low edge of the shaded band (we use P10). */
  bandLo: number;
  /** High edge of the shaded band (we use P90). */
  bandHi: number;
  p99?: number;
  domainMax: number;
  color?: string;
  unit?: string;
  showScale?: boolean;
}) {
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / (domainMax || 1)) * 100))}%`;
  return (
    <div className="w-full min-w-[120px]">
      <div className="relative h-[18px]">
        <div className="absolute top-2 right-0 left-0 h-[2px] bg-(--bar-track)" />
        <div
          className="absolute top-[5px] h-2 rounded-[1px] opacity-[0.28]"
          style={{
            left: x(bandLo),
            width: `calc(${x(bandHi)} - ${x(bandLo)})`,
            background: color,
          }}
          title={`p10 ${bandLo} → p90 ${bandHi}`}
        />
        <div
          className="absolute top-[3px] h-3 w-[2px]"
          style={{ left: x(p50), background: color }}
          title={`p50 ${p50}`}
        />
        <div
          className="absolute top-[5px] h-2 w-[1.5px] opacity-70"
          style={{ left: x(bandHi), background: color }}
          title={`p90 ${bandHi}`}
        />
        {p99 !== undefined && (
          <div
            className="absolute top-px h-4 w-px bg-(--annotation)"
            style={{ left: x(p99) }}
            title={`p99 ${p99}`}
          />
        )}
      </div>
      {showScale && (
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-(--axis-text)">
          <span>
            0{unit}
          </span>
          <span>
            {Math.round(domainMax)}
            {unit}
          </span>
        </div>
      )}
    </div>
  );
}
