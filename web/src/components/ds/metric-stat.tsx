import { DeltaValue } from "@/components/ds/delta-value";

// A labelled instrument readout: eyebrow label, large mono value, optional
// delta and note. `inverse` renders on dark hero surfaces.
export function MetricStat({
  label,
  value,
  unit,
  delta,
  deltaUnit = "%",
  lowerIsBetter = false,
  note,
  accent,
  inverse,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  deltaUnit?: string;
  lowerIsBetter?: boolean;
  note?: string;
  accent?: string;
  inverse?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        className="pb-label truncate"
        style={{
          minHeight: "var(--label-line)",
          color: inverse ? "var(--gray-500)" : "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-[5px] whitespace-nowrap">
        <span
          className="pb-num font-medium"
          style={{
            fontSize: "var(--mono-lg-size)",
            lineHeight: "var(--mono-lg-line)",
            letterSpacing: "var(--mono-lg-track)",
            color: accent || (inverse ? "var(--gray-0)" : "var(--text-primary)"),
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            className="font-mono text-[13px]"
            style={{ color: inverse ? "var(--gray-500)" : "var(--text-muted)" }}
          >
            {unit}
          </span>
        )}
      </div>
      {(delta !== undefined || note) && (
        <div className="flex items-center gap-2 whitespace-nowrap">
          {delta !== undefined && (
            <DeltaValue value={delta} unit={deltaUnit} lowerIsBetter={lowerIsBetter} />
          )}
          {note && (
            <span
              className="text-[12px]"
              style={{ color: inverse ? "var(--gray-500)" : "var(--text-faint)" }}
            >
              {note}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
