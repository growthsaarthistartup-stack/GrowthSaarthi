/**
 * buildIdempotencyKey — pure function, no side effects.
 *
 * Constructs a deterministic dedup key so that re-running the same agent
 * step (e.g. after a Celery retry or a duplicate webhook) produces a
 * no-op read in GraphRepository.write_fact() instead of a duplicate row.
 *
 * window = the natural dedup boundary for that fact type:
 *   - WebsiteScan    → "YYYY-MM-DD"
 *   - TrafficMetric  → "YYYY-MM-DD:<metric_type>"
 *   - CompetitorScan → ISO week string e.g. "2026-W29"
 *   - Stripe events  → use the raw Stripe event ID directly (already unique)
 */
export function buildIdempotencyKey(
  entityType: string,
  startupId: string,
  source: string,
  window: string,
): string {
  return `${entityType}:${startupId}:${source}:${window}`;
}

/** Convenience: today's date as YYYY-MM-DD (UTC). */
export function todayWindow(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convenience: ISO week string like "2026-W29" (UTC). */
export function isoWeekWindow(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
