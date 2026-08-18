/**
 * GET /api/cron/weekly
 *
 * Vercel Cron — runs once weekly (schedule in vercel.json: "0 3 * * 1" = Monday 03:00 UTC).
 * Pro tip: on Vercel Hobby plan only 1 cron is free — use /api/cron/daily for the primary job
 * and invoke this route manually or upgrade to Pro for the second schedule.
 *
 * Per invocation:
 *   1. Authenticate via CRON_SECRET header
 *   2. Re-run competitor discovery for all startups (SerpApi: 100 searches/month;
 *      weekly per startup = controlled budget)
 *   3. Re-run SEO ingestion for all startups with a website URL
 *
 * Budget note: 100 SerpApi searches/month ÷ 4 weeks = 25/week.
 * With ≤25 active startups, weekly competitor refresh stays within free tier.
 * competitor-agent already caches aggressively via idempotency keys.
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { startups } from "@/lib/db/schema";
import { discoverCompetitors } from "@/lib/agents/competitor-agent";
import { runSeoIngestion } from "@/lib/agents/seo-agent";
import { writeAgentFailure } from "@/lib/db/repository";

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Auth — same pattern as daily route
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !process.env.VERCEL;
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  const allStartups = await db
    .select({ id: startups.id, name: startups.name, url: startups.url })
    .from(startups);

  if (allStartups.length === 0) {
    return Response.json({ ok: true, processed: 0, message: "No startups yet" });
  }

  // ── 1. Competitor re-discovery ──────────────────────────────────────────
  const competitorResults = await Promise.allSettled(
    allStartups.map((s) => discoverCompetitors(s.id)),
  );

  competitorResults.forEach((r, i) => {
    if (r.status === "rejected") {
      const s = allStartups[i];
      console.error(`[cron/weekly] competitor-agent failed for ${s?.name}:`, r.reason);
      writeAgentFailure(s?.id ?? "unknown", "competitor_agent_weekly", r.reason).catch(() => {});
    }
  });

  // ── 2. SEO re-scan (only startups with a URL) ──────────────────────────
  const startupswithUrl = allStartups.filter((s) => !!s.url);

  const seoResults = await Promise.allSettled(
    startupswithUrl.map((s) => {
      let domain: string;
      try {
        domain = new URL(s.url!).hostname;
      } catch {
        return Promise.resolve(null);
      }
      return runSeoIngestion(s.id, domain);
    }),
  );

  seoResults.forEach((r, i) => {
    if (r.status === "rejected") {
      const s = startupswithUrl[i];
      console.error(`[cron/weekly] seo-agent failed for ${s?.name}:`, r.reason);
      writeAgentFailure(s?.id ?? "unknown", "seo_agent_weekly", r.reason).catch(() => {});
    }
  });

  return Response.json({
    ok: true,
    startups: allStartups.length,
    competitorErrors: competitorResults.filter((r) => r.status === "rejected").length,
    seoErrors:        seoResults.filter((r) => r.status === "rejected").length,
    durationMs:       Date.now() - started,
  });
}
