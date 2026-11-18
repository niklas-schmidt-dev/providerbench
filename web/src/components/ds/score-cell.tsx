// Performance ramp chip: value 0–100 mapped onto the worse→better ramp.
// The ramp is shared with heat cells so "good" reads identically everywhere.
const RAMP = [
  "var(--ramp-0)",
  "var(--ramp-1)",
  "var(--ramp-2)",
  "var(--ramp-3)",
  "var(--ramp-4)",
  "var(--ramp-5)",
] as const;

export function rampColor(value: number, min = 0, max = 100): string {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
}

export function ScoreCell({
  value,
  min = 0,
  max = 100,
  suffix = "",
  size = "md",
  bare,
}: {
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  size?: "sm" | "md";
  bare?: boolean;
}) {
  const color = rampColor(value, min, max);
  const label = Number.isInteger(value) ? value : value.toFixed(1);
  if (bare) {
    return (
      <span className="pb-num font-medium" style={{ color }}>
        {label}
        {suffix}
      </span>
    );
  }
  return (
    <span
      className="pb-num inline-flex items-center justify-center rounded-(--radius-xs) font-medium text-white"
      style={{
        minWidth: size === "sm" ? 36 : 44,
        height: size === "sm" ? 20 : 24,
        padding: "0 7px",
        background: color,
        fontSize: size === "sm" ? 11.5 : 13,
      }}
    >
      {label}
      {suffix}
    </span>
  );
}
