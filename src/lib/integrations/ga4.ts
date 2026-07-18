/**
 * GA4 Integration — daily pull via Google Analytics Data API (free, OAuth).
 *
 * Gate: runs only if an active GA4 Integration row exists for this startup.
 * If no integration → skip gracefully, return null.
 *
 * Writes: Metric facts (type "sessions" + "conversions") with idempotency key
 *         = "TrafficMetric:{startupId}:ga4:{YYYY-MM-DD}" — safe to retry.
 *
 * Anomaly detection: z-score on rolling 7-day window.
 * Alerts written as TelemetryEvent (full Alert entity is Phase 4).
 */

import { eq, and } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/lib/db/client";
import { integrations, metrics } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// GA4 OAuth2 client
// ---------------------------------------------------------------------------

function buildGa4Client(integration: { accessToken: string | null; refreshToken: string | null }) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({
    access_token:  integration.accessToken,
    refresh_token: integration.refreshToken,
  });
  return auth;
}

// ---------------------------------------------------------------------------
// GA4 Data API query
// ---------------------------------------------------------------------------

interface Ga4Row {
  date:        string;   // YYYYMMDD
  sessions:    number;
  conversions: number;
  bounceRate:  number;
  avgDuration: number;
}

async function fetchGa4Report(
  auth: ReturnType<typeof buildGa4Client>,
  propertyId: string,
): Promise<Ga4Row[]> {
  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

  const res = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "conversions" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      orderBys:   [{ dimension: { dimensionName: "date" } }],
    },
  });

  const rows = res.data.rows ?? [];
  return rows.map((r) => ({
    date:        r.dimensionValues?.[0]?.value ?? "",
    sessions:    Number(r.metricValues?.[0]?.value ?? 0),
    conversions: Number(r.metricValues?.[1]?.value ?? 0),
    bounceRate:  Number(r.metricValues?.[2]?.value ?? 0),
    avgDuration: Number(r.metricValues?.[3]?.value ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Z-score anomaly detection (spec §13) — pure math, no LLM
// ---------------------------------------------------------------------------

function detectAnomaly(values: number[]): { isAnomaly: boolean; zScore: number } {
  if (values.length < 2) return { isAnomaly: false, zScore: 0 };
  const window  = values.slice(0, -1);
  const last    = values[values.length - 1];
  const mean    = window.reduce((a, b) => a + b, 0) / window.length;
  const std     = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length) + 0.001;
  const zScore  = (last - mean) / std;
  return { isAnomaly: zScore < -2.0, zScore };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type MetricRow = typeof metrics.$inferSelect;

export async function pullGa4(startupId: string): Promise<MetricRow[] | null> {
  try {
    // Gate: check for active GA4 integration
    const [integration] = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.startupId, startupId),
          eq(integrations.type, "ga4"),
          eq(integrations.connected, true),
        ),
      )
      .limit(1);

    if (!integration) {
      console.info(`[ga4] No active GA4 integration for ${startupId} — skipping.`);
      return null;
    }

    // GA4 property ID stored in the integration scopes JSON as { propertyId: "..." }
    const scopesMeta = integration.scopesJson
      ? (JSON.parse(integration.scopesJson) as { propertyId?: string })
      : {};
    const propertyId = scopesMeta.propertyId;
    if (!propertyId) throw new Error("GA4 propertyId not found in integration.scopesJson");

    const auth  = buildGa4Client(integration);
    const rows  = await fetchGa4Report(auth, propertyId);
    const written: MetricRow[] = [];

    const sessionValues: number[] = [];

    for (const row of rows) {
      // Format date from YYYYMMDD → YYYY-MM-DD
      const date = row.date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

      // Write sessions metric
      const sessKey = buildIdempotencyKey("TrafficMetric", startupId, "ga4", date + ":sessions");
      const [sessMet] = await db
        .insert(metrics)
        .values({
          id:             generateULID(),
          startupId,
          idempotencyKey: sessKey,
          type:           "sessions",
          value:          row.sessions,
          date,
          source:         "ga4",
        })
        .onConflictDoNothing()
        .returning();
      if (sessMet) written.push(sessMet);

      // Write conversions metric
      const convKey = buildIdempotencyKey("TrafficMetric", startupId, "ga4", date + ":conversions");
      const [convMet] = await db
        .insert(metrics)
        .values({
          id:             generateULID(),
          startupId,
          idempotencyKey: convKey,
          type:           "conversions",
          value:          row.conversions,
          date,
          source:         "ga4",
        })
        .onConflictDoNothing()
        .returning();
      if (convMet) written.push(convMet);

      sessionValues.push(row.sessions);
    }

    // Anomaly detection on sessions (last 7 days)
    const recentSessions = sessionValues.slice(-7);
    if (recentSessions.length >= 7) {
      const { isAnomaly, zScore } = detectAnomaly(recentSessions);
      if (isAnomaly) {
        const drop = ((recentSessions[recentSessions.length - 1] /
          (recentSessions.slice(0, -1).reduce((a, b) => a + b, 0) / (recentSessions.length - 1))) - 1) * 100;
        console.warn(
          `[ga4] Traffic anomaly detected for ${startupId}: ${drop.toFixed(0)}% drop (z=${zScore.toFixed(2)})`,
        );
        // Phase 4: trigger alert / notification here
      }
    }

    return written;
  } catch (err) {
    await writeAgentFailure(startupId, "ga4_agent", err);
    return null;
  }
}
