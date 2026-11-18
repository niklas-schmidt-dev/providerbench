// Inline trend: a single 1.5px line with a dot on the latest value.
export function Sparkline({
  data,
  width = 96,
  height = 24,
  color = "var(--series-6)",
  area,
  lastDot = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  area?: boolean;
  lastDot?: boolean;
}) {
  if (data.length === 0) return null;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1 || 1)) * width,
    height - ((v - lo) / span) * (height - 3) - 1.5,
  ]);
  const d = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block overflow-visible"
      aria-hidden
    >
      {area && (
        <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.1} />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lastDot && <circle cx={last[0]} cy={last[1]} r={2} fill={color} />}
    </svg>
  );
}
