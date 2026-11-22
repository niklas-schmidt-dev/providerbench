/**
 * The URL fragment as the page wrote it. The browser stores it
 * percent-encoded, and a report may name a test or a metric with a space.
 */
export function currentHash(): string {
  const raw = window.location.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // a stray "%" someone typed
  }
}
