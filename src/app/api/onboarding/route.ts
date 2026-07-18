/**
 * POST /api/onboarding
 *
 * Accepts: { startupName, websiteUrl, stage, primaryGoal }
 * Creates a Startup row, runs ingestion agents in parallel (Promise.allSettled —
 * one failure never blocks the others), calculates health score, builds the
 * 30-day plan, and returns { scores, plan, gaps, opportunities }.
 *
 * This route is the fire-and-forget path used by handleStartScan after the
 * SSE progress stream closes. It returns the structured report the UI maps
 * onto the report section.
 *
 * GET /api/onboarding/progress handles the SSE stream — see that file.
 */

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { startups } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { scrapeWebsite } from "@/lib/agents/website-scraper";
import { discoverCompetitors } from "@/lib/agents/competitor-agent";
import { runSeoIngestion } from "@/lib/agents/seo-agent";
import { runSeoAnalysis } from "@/lib/agents/seo-analysis-agent";
import { calculateHealthScore } from "@/lib/scoring/health-score";
import { rankRecommendations } from "@/lib/scoring/recommendation-engine";
import { build30DayPlan } from "@/lib/scoring/plan-sequencer";
import { logEvent } from "@/lib/telemetry";

// ---------------------------------------------------------------------------
// Types returned to the UI
// ---------------------------------------------------------------------------

export interface ScanScores {
  overall:    number;
  validation: number;
  growth:     number;
  technical:  number;
}

export interface ScanGap {
  title:       string;
  description: string;
}

export interface ScanOpportunity {
  title:       string;
  description: string;
}

export interface ScanPlanTask {
  id:     number;    // sequence number (1-based) for UI key
  recId?: string;   // real DB recommendation id — used by approve/edit/ignore routes
  week:   string;
  title:  string;
  detail: string;
  status: "pending" | "approved" | "edited" | "ignored";
  source: string;
  metric: string;
  agent:  string;
}

export interface ScanResult {
  startupId:     string;
  scores:        ScanScores;
  gaps:          ScanGap[];
  opportunities: ScanOpportunity[];
  plan:          ScanPlanTask[];
}

// ---------------------------------------------------------------------------
// Stage mapping — UI sends "Idea" | "MVP" | "Growth"
// ---------------------------------------------------------------------------

function toStage(raw: string): "idea" | "mvp" | "growth" {
  const map: Record<string, "idea" | "mvp" | "growth"> = {
    Idea: "idea", MVP: "mvp", Growth: "growth",
  };
  return map[raw] ?? "mvp";
}

function toGoal(raw: string): "get_more_customers" | "retain_existing_customers" {
  return raw === "retention" ? "retain_existing_customers" : "get_more_customers";
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  let body: {
    startupName?: string;
    websiteUrl?:  string;
    stage?:       string;
    primaryGoal?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupName, websiteUrl, stage = "MVP", primaryGoal = "acquisition" } = body;

  if (!startupName?.trim()) {
    return Response.json({ error: "startupName is required" }, { status: 400 });
  }

  // ── 1. Create (or reuse) a Startup row ───────────────────────────────────
  const startupId = generateULID();
  const normalizedUrl = websiteUrl?.trim()
    ? (websiteUrl.startsWith("http") ? websiteUrl.trim() : `https://${websiteUrl.trim()}`)
    : null;

  await db.insert(startups).values({
    id:          startupId,
    name:        startupName.trim(),
    url:         normalizedUrl,
    stage:       toStage(stage),
    primaryGoal: toGoal(primaryGoal),
  }).onConflictDoNothing();

  await logEvent(startupId, "signup_started");

  // ── 2. Run ingestion agents in parallel — one failure never blocks others ─
  const domain = normalizedUrl
    ? (() => { try { return new URL(normalizedUrl).hostname; } catch { return null; } })()
    : null;

  const [scanResult, compResult, seoResult] = await Promise.allSettled([
    normalizedUrl ? scrapeWebsite(startupId, normalizedUrl) : Promise.resolve(null),
    discoverCompetitors(startupId),
    domain ? runSeoIngestion(startupId, domain) : Promise.resolve(null),
  ]);

  // Log any agent failures (non-throwing — already written to agent_failures table by each agent)
  if (scanResult.status === "rejected") console.error("[onboarding] website-scraper threw:", scanResult.reason);
  if (compResult.status === "rejected") console.error("[onboarding] competitor-agent threw:", compResult.reason);
  if (seoResult.status  === "rejected") console.error("[onboarding] seo-agent threw:",  seoResult.reason);

  // ── 3. Analysis — SEO recommendations (may be empty on first run) ─────────
  await runSeoAnalysis(startupId).catch(() => null);

  // ── 4. Health score ───────────────────────────────────────────────────────
  const healthScore = await calculateHealthScore(startupId, toStage(stage));

  // ── 5. Rank recommendations + build plan ──────────────────────────────────
  const rankedRecs = await rankRecommendations(startupId);
  const plan       = await build30DayPlan(rankedRecs, startupId);

  // ── 6. Shape response for the UI ─────────────────────────────────────────
  const competitors = compResult.status === "fulfilled" ? (compResult.value ?? []) : [];

  // Gaps — drawn from competitors with high similarity (they overlap)
  const gaps: ScanGap[] = competitors.slice(0, 3).map((c) => ({
    title:       `Positioning overlap with ${c.name}`,
    description: c.positioningAngle
      ? `"${c.positioningAngle}" — your hero copy significantly overlaps. Differentiation needed.`
      : `${c.name} targets the same audience segment. Value prop clarity is critical.`,
  }));

  if (gaps.length === 0) {
    gaps.push({
      title:       "No competitor data yet",
      description: "Connect a website URL to enable competitor positioning analysis.",
    });
  }

  // Opportunities — from top-ranked recommendations
  const opportunities: ScanOpportunity[] = rankedRecs.slice(0, 3).map((r) => ({
    title:       r.title,
    description: r.description,
  }));

  if (opportunities.length === 0) {
    opportunities.push({
      title:       "Add your website URL",
      description: "GrowthSaarthi will scan your site and surface specific growth opportunities.",
    });
  }

  // Plan tasks — merge all four weeks into a flat list with week labels
  const weekLabels: Record<number, string> = { 1: "Week 1", 2: "Week 2", 3: "Week 3", 4: "Week 4" };
  const CATEGORY_AGENT: Record<string, string> = {
    seo:            "SEO Agent",
    content:        "Content Agent",
    landing_page:   "Content Agent",
    competitor_gap: "Competitor Agent",
    churn:          "Revenue Agent",
    retention:      "Revenue Agent",
  };

  let taskId = 1;
  const planTasks: ScanPlanTask[] = [];
  for (const weekNum of [1, 2, 3, 4] as const) {
    for (const rec of plan[weekNum]) {
      planTasks.push({
        id:     taskId++,
        recId:  rec.id,
        week:   weekLabels[weekNum],
        title:  rec.title,
        detail: rec.description,
        status: "pending",
        source: `Evidence: ${rec.evidenceFactIds.length} fact(s) cited`,
        metric: `Impact score: ${(rec.impactScore * 100).toFixed(0)}%`,
        agent:  CATEGORY_AGENT[rec.category] ?? "Growth Agent",
      });
    }
  }

  // Fall back to static defaults when no recommendations exist yet (cold DB)
  if (planTasks.length === 0) {
    planTasks.push(
      {
        id: 1, week: "Week 1",
        title:  "Add your website URL to unlock full scan",
        detail: "A URL enables the scraping, SEO, and competitor intelligence agents.",
        status: "pending",
        source: "System: Pre-scan placeholder",
        metric: "Target: Enable full pipeline",
        agent:  "Growth Agent",
      },
    );
  }

  const result: ScanResult = {
    startupId,
    scores: {
      overall:    healthScore.overall,
      validation: healthScore.validation,
      growth:     healthScore.growth,
      technical:  healthScore.technical,
    },
    gaps,
    opportunities,
    plan: planTasks,
  };

  await logEvent(startupId, "report_delivered", { overallScore: healthScore.overall });

  return Response.json({ ok: true, ...result });
}
