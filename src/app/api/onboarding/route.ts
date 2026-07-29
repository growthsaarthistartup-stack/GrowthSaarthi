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
import { requireAuth } from "@/lib/api-auth";
import { validateWebsiteUrl } from "@/lib/url-guard";

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
  logoUrl?:      string | null;
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
  // ── 0. Authenticate ──────────────────────────────────────────────────────
  const authResult = await requireAuth(request);
  if (authResult.error) return authResult.error;
  const { user } = authResult;

  let body: {
    startupName?: string;
    websiteUrl?:  string;
    stage?:       string;
    primaryGoal?: string;
    country?:     string;
    industry?:    string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupName, websiteUrl, stage = "MVP", primaryGoal = "acquisition", country, industry } = body;

  if (!startupName?.trim()) {
    return Response.json({ error: "startupName is required" }, { status: 400 });
  }

  // ── SSRF guard — validate websiteUrl before any fetch ────────────────────
  let normalizedUrl: string | null = null;
  if (websiteUrl?.trim()) {
    const urlCheck = validateWebsiteUrl(websiteUrl.trim());
    if (!urlCheck.ok) {
      return Response.json({ error: urlCheck.error }, { status: 422 });
    }
    normalizedUrl = urlCheck.normalizedUrl!;
  }

  // ── Demo / preview mode ───────────────────────────────────────────────────
  // When DATABASE_URL is not configured the product is in "demo" mode.
  // We return realistic, input-personalised mock results so the user can
  // immediately understand the value without completing a full setup.
  if (!process.env.DATABASE_URL) {
    const mockScores = {
      overall:    primaryGoal === "retention" ? 78 : 73,
      validation: stage === "Idea" ? 42 : stage === "MVP" ? 65 : 88,
      growth:     primaryGoal === "retention" ? 82 : 58,
      technical:  stage === "Idea" ? 50 : stage === "MVP" ? 72 : 91,
    };

    return Response.json({
      ok:        true,
      startupId: "demo_startup",
      scores:    mockScores,
      gaps: [
        {
          title:       "Value Proposition Overlap",
          description: `Your value proposition significantly overlaps with competitors in the ${industry || "your"} space. Clear differentiation is required.`,
        },
        {
          title:       "SEO Indexation Gap",
          description: "Structured content keywords are missing. Search engines are not indexing organic pages for key search intents.",
        },
      ],
      opportunities: [
        {
          title:       "Landing Page Copy Optimisation",
          description: "Rewriting hero copy and CTAs can increase signup conversions by up to 15%.",
        },
        {
          title:       "Competitor Keyword Capture",
          description: "Targeting gap keywords found on competitor blogs can capture high-intent organic traffic.",
        },
      ],
      plan: [
        { id: 1, recId: "demo_1", week: "Week 1", title: "Optimise Landing Page Hero Copy for SEO",        detail: "Replace current header copy with a benefit-driven statement targeting your primary audience keywords.",                                   status: "pending", source: "Website Scraper: Weak CTA alignment detected.", metric: "Target: Conversion Rate +18%", agent: "Content Agent"    },
        { id: 2, recId: "demo_2", week: "Week 1", title: "Implement Stripe Churn Recovery Sequence",       detail: "Create an automatic email sequence triggered when payments fail — recover lost MRR without manual intervention.",                  status: "pending", source: "Revenue Agent: Payment failure churn increased 2.8%.", metric: "Target: Churn Rate −4%",         agent: "Revenue Agent"    },
        { id: 3, recId: "demo_3", week: "Week 2", title: "Publish Blog Post Targeting Competitor Keywords", detail: "Draft and publish a high-quality article targeting keywords your competitors rank for but you are missing.",                        status: "pending", source: "SEO Agent: 3 high-volume gap keywords identified.",    metric: "Target: Organic Traffic +12%",    agent: "SEO Agent"        },
        { id: 4, recId: "demo_4", week: "Week 3", title: "Configure GA4 Conversion Event Tracking",        detail: "Set up explicit tracking for signup button clicks and purchase success pages to map the full conversion funnel.",                  status: "pending", source: "Orchestrator: Conversion stream missing in GA4.",    metric: "Target: Funnel Visibility 100%",  agent: "Integration Agent" },
        { id: 5, recId: "demo_5", week: "Week 4", title: "Launch LinkedIn Thought Leadership Campaign",     detail: "Publish 3 authority posts on LinkedIn in your niche — agent has drafted the copy based on your industry and competitor analysis.", status: "pending", source: "Competitor Agent: Top rivals drive 15% traffic via LinkedIn.", metric: "Target: Referral Traffic +22%",   agent: "Competitor Agent"  },
      ],
    });
  }

  // ── 1. Create (or reuse) the Startup row for this authenticated user ─────
  // Deduplication: if this user already has a startup, reuse it instead of
  // creating a new orphan row on every form submission.
  let startupId: string;
  const [existingStartup] = await db
    .select({ id: startups.id })
    .from(startups)
    .where(eq(startups.userId, user.id))
    .limit(1);

  if (existingStartup) {
    startupId = existingStartup.id;
    // Update mutable fields in case user changed them
    await db.update(startups).set({
      name:        startupName.trim(),
      url:         normalizedUrl,
      stage:       toStage(stage),
      primaryGoal: toGoal(primaryGoal),
      country:     country?.trim() || null,
      industry:    industry?.trim() || null,
      updatedAt:   new Date(),
    }).where(eq(startups.id, startupId));
  } else {
    startupId = generateULID();
    await db.insert(startups).values({
      id:          startupId,
      userId:      user.id,
      name:        startupName.trim(),
      url:         normalizedUrl,
      stage:       toStage(stage),
      primaryGoal: toGoal(primaryGoal),
      country:     country?.trim() || null,
      industry:    industry?.trim() || null,
    });
  }

  await logEvent(startupId, "signup_started");

  // ── 2. Run Ingestion Agents ─────────────────────────────────────────────
  const domain = normalizedUrl
    ? (() => { try { return new URL(normalizedUrl).hostname; } catch { return null; } })()
    : null;

  // Run scraper first so that website scan is fully committed to DB
  let logoUrl: string | null = null;
  if (normalizedUrl) {
    try {
      const scan = await scrapeWebsite(startupId, normalizedUrl);
      if (scan) {
        logoUrl = scan.logoUrl;
        if (logoUrl) {
          await db.update(startups)
            .set({ logoUrl, updatedAt: new Date() })
            .where(eq(startups.id, startupId))
            .catch((err) => console.error("[onboarding] failed to update startup logoUrl:", err));
        }
      }
    } catch (e) {
      console.error("[onboarding] website-scraper threw:", e);
    }
  }

  // Now run competitors and SEO ingestion in parallel since they depend on the scan data!
  const [compResult, seoResult] = await Promise.allSettled([
    discoverCompetitors(startupId),
    domain ? runSeoIngestion(startupId, domain) : Promise.resolve(null),
  ]);

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
    logoUrl,
  };

  await logEvent(startupId, "report_delivered", { overallScore: healthScore.overall });

  return Response.json({ ok: true, ...result });
}
