/**
 * Shared, framework-free presentation formatters for the web app. Deterministic and
 * locale-independent by design (no Intl / toLocale*): identical output on the server and
 * in every browser, so hydration never mismatches. Consolidated here so the dashboard, the
 * connection page, and the pricing surfaces share ONE implementation instead of drifting
 * per-file copies — behaviour is byte-for-byte the previous inline versions.
 */

/** Format an integer with thousands separators (e.g. 1000 -> "1,000", -2500 -> "-2,500"). */
export function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Render an ISO timestamp as YYYY-MM-DD; fall back to the raw value if unparseable. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
