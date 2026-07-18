/**
 * Anomaly Detector — pure z-score check on 7-day rolling window.
 *
 * Algorithm (spec §3 / §10):
 *   For each metric type in {sessions, conversions, mrr}:
 *     1. Pull the last 7 days of metric rows for a startup
 *     2. Compute mean and stddev of the values
 *     3. z = (today - mean) / stddev
 *     4. If z < -2.0 → write Alert fact + send Resend email notification
 *
 * Pure scoring functions (computeZScore, detectAnomalies) are exported for
 * unit tests — zero I/O. checkStartupAnomalies() is the DB-wired entry point
 * used by the cron route.
 *
 * Notification: Resend free tier (100 emails/day). Set RESEND_API_KEY in .env.local.
 * If key is absent, alert is still written to DB — email silently skipped.
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { metrics, alerts, startups } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const Z_SCORE_THRESHOLD = -2.0;
export const ROLLING_WINDOW_DAYS = 7;

const MONITORED_METRICS = ["sessions", "conversions", "mrr"] as const;
type MonitoredMetric = (typeof MONITORED_METRICS)[number];

// ---------------------------------------------------------------------------
// Pure math — exported for unit tests
// ---------------------------------------------------------------------------

/** Sample standard deviation (n-1 denominator). Returns 0 if < 2 values. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Mean of an array. Returns 0 on empty input (degrades to neutral, never throws). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute z-score for the latest value against the window.
 * Returns null when there are fewer than 3 data points (not enough signal).
 */
export function computeZScore(windowValues: number[], latestValue: number): number | null {
  if (windowValues.length < 3) return null;
  const sd = stddev(windowValues);
  if (sd === 0) return null; // no variance — skip
  const mu = mean(windowValues);
  return (latestValue - mu) / sd;
}

export interface AnomalyResult {
  metricType: MonitoredMetric;
  zScore: number;
  latestValue: number;
  windowMean: number;
  message: string;
}

/**
 * Detect anomalies across multiple metric series.
 * windowValues must not include latestValue (latest is the point being checked).
 */
export function detectAnomalies(
  series: Record<string, { windowValues: number[]; latestValue: number }>,
): AnomalyResult[] {
  const results: AnomalyResult[] = [];

  for (const metricType of MONITORED_METRICS) {
    const data = series[metricType];
    if (!data) continue;

    const z = computeZScore(data.windowValues, data.latestValue);
    if (z === null) continue;

    if (z < Z_SCORE_THRESHOLD) {
      const mu = mean(data.windowValues);
      const drop = mu > 0 ? (((data.latestValue - mu) / mu) * 100).toFixed(1) : "N/A";
      results.push({
        metricType: metricType as MonitoredMetric,
        zScore: z,
        latestValue: data.latestValue,
        windowMean: mu,
        message:
          `Anomaly detected in ${metricType}: today's value (${data.latestValue.toFixed(2)}) ` +
          `is ${Math.abs(z).toFixed(2)}σ below the 7-day average (${mu.toFixed(2)}). ` +
          `Approx ${drop}% drop.`,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Resend email notification
// ---------------------------------------------------------------------------

async function sendAlertEmail(
  to: string,
  startupName: string,
  anomaly: AnomalyResult,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[anomaly-detector] RESEND_API_KEY not set — skipping email notification");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "GrowthSaarthi Alerts <alerts@growthsaarthi.ai>",
        to:      [to],
        subject: `🚨 Metric Anomaly Detected — ${anomaly.metricType} dropped for ${startupName}`,
        html: `
          <h2>GrowthSaarthi Anomaly Alert</h2>
          <p><strong>Startup:</strong> ${startupName}</p>
          <p><strong>Metric:</strong> ${anomaly.metricType}</p>
          <p><strong>Z-Score:</strong> ${anomaly.zScore.toFixed(3)} (threshold: ${Z_SCORE_THRESHOLD})</p>
          <p>${anomaly.message}</p>
          <hr/>
          <p style="color:#666;font-size:12px">
            Log in to your GrowthSaarthi dashboard to see full context and recommended actions.
          </p>
        `,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[anomaly-detector] Resend API error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// DB-wired entry point — used by cron routes
// ---------------------------------------------------------------------------

export interface AlertWritten {
  startupId: string;
  metricType: string;
  zScore: number;
  message: string;
}

export async function checkStartupAnomalies(startupId: string): Promise<AlertWritten[]> {
  const written: AlertWritten[] = [];

  // Load startup for email lookup (url doubles as a contact hint in early phase)
  const [startup] = await db
    .select({ name: startups.name, url: startups.url })
    .from(startups)
    .where(eq(startups.id, startupId))
    .limit(1);

  if (!startup) return [];

  // Pull last ROLLING_WINDOW_DAYS + 1 rows per metric type (window + today)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (ROLLING_WINDOW_DAYS + 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Build series per metric type
  const series: Record<string, { windowValues: number[]; latestValue: number }> = {};

  for (const metricType of MONITORED_METRICS) {
    const rows = await db
      .select({ value: metrics.value, date: metrics.date })
      .from(metrics)
      .where(
        and(
          eq(metrics.startupId, startupId),
          eq(metrics.type, metricType),
          gte(metrics.date, cutoffStr),
        ),
      )
      .orderBy(desc(metrics.date))
      .limit(ROLLING_WINDOW_DAYS + 1);

    if (rows.length < 3) continue; // not enough data — skip gracefully

    const [latest, ...window] = rows;
    series[metricType] = {
      latestValue:  latest.value,
      windowValues: window.map((r) => r.value),
    };
  }

  const anomalies = detectAnomalies(series);

  for (const anomaly of anomalies) {
    // Idempotency: one alert per startup per metric per day
    const iKey = buildIdempotencyKey(
      "Alert",
      startupId,
      anomaly.metricType,
      todayWindow(),
    );

    const severity = anomaly.zScore < -3.0 ? "critical" : "warning";

    const [alertRow] = await db
      .insert(alerts)
      .values({
        id:           generateULID(),
        startupId,
        idempotencyKey: iKey,
        metricType:   anomaly.metricType,
        zScore:       anomaly.zScore,
        severity,
        channel:      "both",
        message:      anomaly.message,
      })
      .onConflictDoNothing()
      .returning();

    if (!alertRow) continue; // duplicate — already alerted today

    // Send email notification via Resend (100/day free tier)
    // Use url domain as a proxy for contact email until auth is wired
    const emailSent = await sendAlertEmail(
      `alerts+${startupId.slice(0, 8)}@growthsaarthi.ai`,
      startup.name,
      anomaly,
    );

    if (emailSent) {
      await db
        .update(alerts)
        .set({ emailSentAt: new Date() })
        .where(eq(alerts.id, alertRow.id));
    }

    written.push({
      startupId,
      metricType: anomaly.metricType,
      zScore:     anomaly.zScore,
      message:    anomaly.message,
    });
  }

  return written;
}
