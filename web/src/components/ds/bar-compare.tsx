// Ranked horizontal bars on a shared scale: label, track, mono value.
// The best value is set in ink; everything else stays muted.
export type BarCompareRow = {
  label: string;
  value: number;
  display?: string;
  color?: string;
  faded?: boolean;
};

export function BarCompare({
  rows,
  unit = "",
  max,
  lowerIsBetter = false,
  barHeight = 10,
  labelWidth = 132,
}: {
  rows: BarCompareRow[];
  unit?: string;
  max?: number;
  lowerIsBetter?: boolean;
  barHeight?: number;
  labelWidth?: number;
}) {
  const values = rows.map((r) => r.value);
  const peak = max || Math.max(...values, 1);
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  return (
    <div className="grid gap-2.5">
      {rows.map((r, i) => {
        const pct = Math.max(1.5, (r.value / peak) * 100);
        const isBest = r.value === best;
        return (
          <div
            key={`${r.label}-${i}`}
            className="grid items-center gap-3"
            style={{
              gridTemplateColumns: `minmax(0,${labelWidth}px) minmax(90px,1fr) auto`,
            }}
          >
            <span className="truncate text-[13px] tracking-[-0.005em] text-(--text-body)">
              {r.label}
            </span>
            <span
              className="relative rounded-[2px] bg-(--bar-track)"
              style={{ height: barHeight }}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-[2px]"
                style={{
                  width: `${pct}%`,
                  background: r.color || `var(--series-${(i % 8) + 1})`,
                  opacity: r.faded ? 0.4 : 1,
                  transition: "var(--transition-bar)",
                }}
              />
            </span>
            <span
              className="pb-num min-w-[62px] text-right text-[13px]"
              style={{
                color: isBest ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: isBest ? 500 : 400,
              }}
            >
              {r.display ?? r.value}
              {unit && <span className="text-[11px] text-(--text-faint)"> {unit}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
