// Tiny scale helpers for the hand-drawn SVG charts. Linear ticks use the
// 1-2-5 "nice" sequence; log ticks walk 1-2-5 within each decade.

export type Scale = {
  (value: number): number;
  ticks: number[];
  domain: [number, number];
};

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  return nice * magnitude;
}

/** Linear scale whose domain is widened to nice tick boundaries. */
export function linearScale(
  [min, max]: [number, number],
  [r0, r1]: [number, number],
  tickCount = 5,
): Scale {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, tickCount);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  const scale = ((value: number) =>
    r0 + ((value - lo) / (hi - lo)) * (r1 - r0)) as Scale;
  scale.ticks = ticks;
  scale.domain = [lo, hi];
  return scale;
}

/** Log10 scale padded to the surrounding 1-2-5 steps. */
export function logScale(
  [min, max]: [number, number],
  [r0, r1]: [number, number],
): Scale {
  const steps = [1, 2, 5];
  const candidates: number[] = [];
  const fromDecade = Math.floor(Math.log10(Math.max(min, 1e-9))) - 1;
  const toDecade = Math.ceil(Math.log10(Math.max(max, 1e-9))) + 1;
  for (let d = fromDecade; d <= toDecade; d++) {
    for (const s of steps) candidates.push(s * 10 ** d);
  }
  const lo = [...candidates].reverse().find((c) => c <= min * 0.92) ?? min;
  const hi = candidates.find((c) => c >= max * 1.08) ?? max;
  const ticks = candidates.filter((c) => c >= lo - 1e-12 && c <= hi + 1e-12);
  const l0 = Math.log10(lo);
  const l1 = Math.log10(hi);
  const scale = ((value: number) =>
    r0 + ((Math.log10(value) - l0) / (l1 - l0)) * (r1 - r0)) as Scale;
  scale.ticks = ticks;
  scale.domain = [lo, hi];
  return scale;
}

/** Axis tick label: compact above 10K, plain otherwise. */
export function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(value / 1_000)}K`;
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return trim(value);
}

function trim(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatEuro(value: number): string {
  if (value >= 100) return `€${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 10) return `€${value.toFixed(value % 1 === 0 ? 0 : 1)}`;
  return `€${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}
