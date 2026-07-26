/**
 * GET /api/cron/daily
 *
 * Vercel Cron — runs once daily (schedule in vercel.json: "0 2 * * *" UTC).
 *
 * Per invocation:
 *   1. Authenticate via CRON_SECRET header
 *   2. Re-scrape stale startup websites (last scan > 24h ago)
 *   3. Pull GA4 metrics for all startups (agent self-gates on integration presence)
 *   4. Run anomaly-detector on all startups — write Alert facts
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { startups, websiteScans } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { scrapeWebsite } from "@/lib/agents/website-scraper";
import { runGaIngestion } from "@/lib/agents/ga-agent";
import { checkStartupAnomalies } from "@/lib/monitoring/anomaly-detector";
import { writeAgentFailure } from "@/lib/db/repository";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !process.env.VERCEL;
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Stale startup finder
// ---------------------------------------------------------------------------

interface StartupRow { id: string; name: string; url: string | null }

async function findStaleStartups(): Promise<StartupRow[]> {
  const threshold = new Date();
  threshold.setHours(threshold.getHours() - 24);

  // ALG-5 FIX: use a correlated subquery to get MAX(created_at) per startup.
  // Previous LEFT JOIN without MAX() matched stale scan rows even when a newer scan existed.
  const rows = await db
    .select({ id: startups.id, name: startups.name, url: startups.url })
    .from(startups)
    .where(
      sql`(
        SELECT MAX(ws.created_at) FROM website_scans ws
        WHERE ws.startup_id = ${startups.id}
      ) IS NULL
      OR (
        SELECT MAX(ws.created_at) FROM website_scans ws
        WHERE ws.startup_id = ${startups.id}
      ) < ${threshold.toISOString()}`,
    );

  return rows as StartupRow[];
}



// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started       = Date.now();
  const staleStartups = await findStaleStartups();
  const allStartups   = await db.select({ id: startups.id, name: startups.name }).from(startups);

  // ── 1. Website scraper (stale startups with URL only) ────────────────────
  const scraperResults = await Promise.allSettled(
    staleStartups
      .filter((s) => !!s.url)
      .map((s) => scrapeWebsite(s.id, s.url!)),
  );

  scraperResults.forEach((r, i) => {
    if (r.status === "rejected") {
      const s = staleStartups.filter((s) => !!s.url)[i];
      console.error(`[cron/daily] scraper failed for ${s?.name}:`, r.reason);
      writeAgentFailure(s?.id ?? "unknown", "website_scraper_daily", r.reason).catch(() => {});
    }
  });

  // ── 2. GA4 ingestion (all startups — agent self-gates on integration) ─────
  const gaResults = await Promise.allSettled(
    allStartups.map((s) => runGaIngestion(s.id)),
  );

  gaResults.forEach((r, i) => {
    if (r.status === "rejected") {
      const s = allStartups[i];
      console.error(`[cron/daily] ga-agent failed for ${s?.name}:`, r.reason);
      writeAgentFailure(s?.id ?? "unknown", "ga_agent_daily", r.reason).catch(() => {});
    }
  });

  // ── 3. Anomaly detection (all startups) ──────────────────────────────────
  const anomalyResults = await Promise.allSettled(
    allStartups.map((s) => checkStartupAnomalies(s.id)),
  );

  const alertsWritten = anomalyResults
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<unknown[]>).value ?? []);

  return Response.json({
    ok:            true,
    processed:     staleStartups.length,
    scrapeErrors:  scraperResults.filter((r) => r.status === "rejected").length,
    gaErrors:      gaResults.filter((r) => r.status === "rejected").length,
    alertsWritten: alertsWritten.length,
    durationMs:    Date.now() - started,
  });
}
