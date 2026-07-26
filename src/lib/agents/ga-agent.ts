/**
 * GA4 Ingestion Agent — pulls traffic + conversion trends from Google Analytics 4.
 *
 * Uses GA4 Data API v1beta via REST (no external npm dep — runs with built-in fetch).
 * Authentication uses a service-account access token fetched via Google OAuth2.
 *
 * Flow:
 *   1. Daily idempotency — skip if already ran today.
 *   2. Gate on an active GA4 integration row; skip gracefully if none.
 *   3. Fetch short-lived access token via service account JWT.
 *   4. Call GA4 Data API: sessions + conversions for last 30 days.
 *   5. Write to metrics table (type='sessions' | 'conversions'), append-only.
 *   6. On ANY error: writeAgentFailure, return null.
 *
 * No LLM calls. Pure data ingestion.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { integrations, metrics } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// GA4 REST API types
// ---------------------------------------------------------------------------

interface Ga4Row {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?:   Array<{ value?: string }>;
}

interface Ga4Response {
  rows?: Ga4Row[];
  rowCount?: number;
}

// ---------------------------------------------------------------------------
// Service-account JWT + token fetch (no external dep)
// ---------------------------------------------------------------------------

async function fetchGoogleAccessToken(): Promise<string | null> {
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    console.warn("[ga-agent] GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY not set");
    return null;
  }

  // Build JWT header + claim
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss:   email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  })).toString("base64url");

  // Sign with RSA-SHA256 using Web Crypto (available in Next.js edge/node runtimes)
  const pemBody = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const keyBuf = Buffer.from(pemBody, "base64");
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );

  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(`${header}.${payload}`),
  );

  const sig = Buffer.from(sigBuf).toString("base64url");
  const jwt = `${header}.${payload}.${sig}`;

  // Exchange JWT for access token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.warn("[ga-agent] Google token exchange failed:", await res.text());
    return null;
  }

  const data = await res.json() as { access_token?: string };
  return data.access_token ?? null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GaMetricRow {
  date:  string;
  type:  "sessions" | "conversions";
  value: number;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runGaIngestion(
  startupId: string,
): Promise<GaMetricRow[] | null> {
  // Daily idempotency guard — check for any row written today
  const iKey = buildIdempotencyKey("GaIngestion", startupId, "ga4", todayWindow());
  const [alreadyRan] = await db
    .select({ id: metrics.id })
    .from(metrics)
    .where(eq(metrics.idempotencyKey, `${iKey}:sessions:0`))
    .limit(1);

  if (alreadyRan) {
    console.info(`[ga-agent] Already ingested GA4 for ${startupId} today — skipping.`);
    return [];
  }

  try {
    // Gate on active GA4 integration
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
      // Graceful skip — no GA4 integration connected
      return null;
    }

    // Parse propertyId from integration scopesJson
    const propertyId = integration.scopesJson
      ? (() => {
          try {
            const s = JSON.parse(integration.scopesJson) as Record<string, string>;
            return s.propertyId ?? null;
          } catch { return null; }
        })()
      : null;

    if (!propertyId) {
      console.warn(`[ga-agent] GA4 integration for ${startupId} missing propertyId`);
      return null;
    }

    const token = await fetchGoogleAccessToken();
    if (!token) return null;

    // Call GA4 Data API
    const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges:  [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions:  [{ name: "date" }],
        metrics:     [{ name: "sessions" }, { name: "conversions" }],
        orderBys:    [{ dimension: { dimensionName: "date" } }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.warn(`[ga-agent] GA4 API error ${res.status}:`, await res.text());
      return null;
    }

    const data = await res.json() as Ga4Response;
    const rows  = data.rows ?? [];
    const written: GaMetricRow[] = [];

    for (const [rowIdx, row] of rows.entries()) {
      const rawDate     = row.dimensionValues?.[0]?.value ?? todayWindow().replace(/-/g, "");
      const dateStr     = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      const sessions    = parseFloat(row.metricValues?.[0]?.value ?? "0");
      const conversions = parseFloat(row.metricValues?.[1]?.value ?? "0");

      if (sessions > 0) {
        await db.insert(metrics).values({
          id:             generateULID(),
          startupId,
          idempotencyKey: `${iKey}:sessions:${rowIdx}`,
          type:           "sessions",
          value:          sessions,
          date:           dateStr,
          source:         "ga4",
        }).onConflictDoNothing();
        written.push({ date: dateStr, type: "sessions", value: sessions });
      }

      if (conversions > 0) {
        await db.insert(metrics).values({
          id:             generateULID(),
          startupId,
          idempotencyKey: `${iKey}:conversions:${rowIdx}`,
          type:           "conversions",
          value:          conversions,
          date:           dateStr,
          source:         "ga4",
        }).onConflictDoNothing();
        written.push({ date: dateStr, type: "conversions", value: conversions });
      }
    }

    // Update integration lastSyncedAt
    await db
      .update(integrations)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(integrations.id, integration.id));

    console.info(`[ga-agent] Wrote ${written.length} GA4 metric rows for ${startupId}`);
    return written;
  } catch (err) {
    await writeAgentFailure(startupId, "ga_agent", err);
    return null;
  }
}
