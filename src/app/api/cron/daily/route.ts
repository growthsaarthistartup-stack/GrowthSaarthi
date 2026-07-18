/**
 * GET /api/cron/daily
 *
 * Vercel Cron — runs once daily (schedule in vercel.json: "0 2 * * *" UTC).
 * Free tier limit: 1 cron job on Hobby plan, so this is the primary route.
 *
 * Per invocation:
 *   1. Authenticate via CRON_SECRET header (Vercel injects automatically)
 *   2. Find all startups with stale website scans (last scan > 24h ago)
 *   3. Re-run website-scraper + GA4 metric pull for each (Promise.allSettled — one
 *      failure never blocks others)
 *   4. Run anomaly-detector on all startups — write Alert facts + send Resend emails
 *
 * Vercel function timeout on Hobby = 10s. Each startup is processed concurrently
 * but the total number is naturally small at this stage. Phase 4 will switch to a
 * queue worker for large cohorts.
 *
 * To enable locally: add CRON_SECRET to .env.local and hit with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { startups, websiteScans } from "@/lib/db/schema";
import { eq, lt, sql } from "drizzle-orm";
import { scrapeWebsite } from "@/lib/agents/website-scraper";
import { checkStartupAnomalies } from "@/lib/monitoring/anomaly-detector";
import { writeAgentFailure } from "@/lib/db/repository";

// ---------------------------------------------------------------------------
// Auth — Vercel injects the Authorization: Bearer <CRON_SECRET> header
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret set — only allow in dev (VERCEL env is set in all Vercel deployments)
    return !process.env.VERCEL;
  }
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Stale startup finder
// ---------------------------------------------------------------------------

interface StartupRow {
  id: string;
  name: string;
  url: string | null;
}

async function findStaleStartups(): Promise<StartupRow[]> {
  const threshold = new Date();
  threshold.setHours(threshold.getHours() - 24);

  // Startups whose most-recent website scan is older than 24h (or never scanned)
  const rows = await db
    .select({
      id:   startups.id,
      name: startups.name,
      url:  startups.url,
    })
    .from(startups)
    .leftJoin(
      websiteScans,
      eq(websiteScans.startupId, startups.id),
    )
    .where(
      sql`${websiteScans.createdAt} IS NULL OR ${websiteScans.createdAt} < ${threshold.toISOString()}`,
    )
    .groupBy(startups.id, startups.name, startups.url);

  return rows as StartupRow[];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const staleStartups = await findStaleStartups();

  if (staleStartups.length === 0) {
    return Response.json({ ok: true, processed: 0, message: "No stale startups found" });
  }

  const scraperResults = await Promise.allSettled(
    staleStartups
      .filter((s) => !!s.url)
      .map((s) => scrapeWebsite(s.id, s.url!)),
  );

  // Log any scraper failures
  scraperResults.forEach((r, i) => {
    if (r.status === "rejected") {
      const s = staleStartups.filter((s) => !!s.url)[i];
      console.error(`[cron/daily] scraper failed for ${s?.name}:`, r.reason);
      writeAgentFailure(
        s?.id ?? "unknown",
        "website_scraper_daily",
        r.reason,
      ).catch(() => {});
    }
  });

  // Run anomaly detection across ALL startups (not just stale-scan ones)
  const allStartups = await db.select({ id: startups.id }).from(startups);
  const anomalyResults = await Promise.allSettled(
    allStartups.map((s) => checkStartupAnomalies(s.id)),
  );

  const alertsWritten = anomalyResults
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer V> ? V : never>).value);

  return Response.json({
    ok: true,
    processed: staleStartups.length,
    scrapeErrors: scraperResults.filter((r) => r.status === "rejected").length,
    alertsWritten: alertsWritten.length,
    durationMs: Date.now() - started,
  });
}
