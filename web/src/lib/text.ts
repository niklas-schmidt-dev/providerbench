// Labels for identifiers nobody wrote a title for. Reports name their
// categories, tests and metrics as slugs (`rand_read_4k`, `ai-language`); a
// page that has to render any report needs a readable form of each.

const UPPERCASE = new Set([
  "ai", "api", "cdn", "cpu", "cv", "dns", "gc", "gpu", "http", "https", "id", "io", "iops", "ip", "json", "kv",
  "llm", "nvme", "os", "p10", "p50", "p90", "p95", "p99", "qps", "ram", "rps", "rtt", "s3", "sql", "ssd", "tcp",
  "tls", "ttfb", "udp", "url", "vm",
]);

function words(id: string): string[] {
  return id.split(/[\s_.-]+/).filter(Boolean);
}

/** `rand_read_4k` → "Rand read 4k", `ai-language` → "AI language". */
export function humanize(id: string): string {
  const parts = words(id).map((word, index) => {
    const lower = word.toLowerCase();
    if (UPPERCASE.has(lower)) return lower.toUpperCase();
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return parts.join(" ") || id;
}

/**
 * The leading words every identifier shares, joined with "_":
 * ["accuracy_en", "accuracy_de"] → "accuracy". Never the whole of an
 * identifier, so each keeps a distinguishing tail.
 */
export function commonPrefix(ids: string[]): string {
  if (ids.length < 2) return "";
  const split = ids.map((id) => id.split("_"));
  const limit = Math.min(...split.map((parts) => parts.length)) - 1;
  let shared = 0;
  while (shared < limit && split.every((parts) => parts[shared] === split[0][shared])) shared++;
  return split[0].slice(0, shared).join("_");
}

/** An identifier without the prefix its siblings share. */
export function withoutPrefix(id: string, prefix: string): string {
  return prefix && id.startsWith(`${prefix}_`) ? id.slice(prefix.length + 1) : id;
}

/** "plan" → "Plan". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
