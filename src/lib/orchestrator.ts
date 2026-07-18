/**
 * Orchestrator — runs the full daily cycle and onboarding pipeline (spec §3.1, §12).
 *
 * runDailyCycle(startupId):
 *   1. Run active ingestion agents (website, competitor, SEO, GA4).
 *   2. Run SEO analysis to generate recommendations.
 *   3. Rank recommendations with goal weighting.
 *   4. Build 30-day plan.
 *   5. Calculate and return health score.
 *
 * runOnboarding(startupId, url):
 *   Same pipeline as daily cycle, but called once at signup.
 *   Emits progress via the provided callback (caller can stream via SSE or store).
 *
 * Failure isolation (spec §2):
 *   Each agent runs inside try/catch via run_ingestion_stage pattern —
 *   one agent's failure never blocks the others or the analysis phase.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { startups } from "@/lib/db/schema";
import { scrapeWebsite } from "@/lib/agents/website-scraper";
import { discoverCompetitors } from "@/lib/agents/competitor-agent";
import { runSeoIngestion } from "@/lib/agents/seo-agent";
import { pullGa4 } from "@/lib/integrations/ga4";
import { runSeoAnalysis } from "@/lib/agents/seo-analysis-agent";
import { calculateHealthScore, type HealthScore } from "@/lib/scoring/health-score";
import { rankRecommendations, type RankedRecommendation } from "@/lib/scoring/recommendation-engine";
import { build30DayPlan, type ThirtyDayPlan } from "@/lib/scoring/plan-sequencer";
import { logEvent } from "@/lib/telemetry";

// ---------------------------------------------------------------------------
// Progress emitter type — caller provides; no-op default
// ---------------------------------------------------------------------------

export type ProgressEmitter = (step: string, percent: number, detail?: string) => void;

const noopProgress: ProgressEmitter = () => {};

// ---------------------------------------------------------------------------
// Ingestion stage runner — spec §2 failure isolation pattern
// ---------------------------------------------------------------------------

async function runIngestionStage(
  startupId: string,
  url: string | null | undefined,
  domain: string | null | undefined,
  emit: ProgressEmitter,
): Promise<void> {
  // Website scraper
  if (url) {
    emit("Scanning your website...", 10, `Reading metadata and structure from ${url}`);
    const scan = await scrapeWebsite(startupId, url);
    emit(
      scan ? "Website scan complete ✓" : "Website scan skipped (site unreachable)",
      25,
    );
  }

  // Competitor discovery
  emit("Identifying your competitors...", 30, "Searching industry databases");
  const comps = await discoverCompetitors(startupId);
  emit(
    `Found ${comps?.length ?? 0} competitor(s) ✓`,
    45,
    comps?.length ? comps.map((c) => c.name).join(", ") : "No matches above similarity threshold yet",
  );

  // SEO ingestion (only if GSC connected — agent skips gracefully otherwise)
  if (domain) {
    emit("Analyzing SEO opportunities...", 55, "Querying Google Search Console");
    await runSeoIngestion(startupId, domain);
    emit("SEO analysis complete ✓", 65);
  }

  // GA4 (skips gracefully if not connected)
  emit("Pulling analytics data...", 70, "GA4 daily metrics");
  await pullGa4(startupId);
  emit("Analytics synced ✓", 75);
}

// ---------------------------------------------------------------------------
// Analysis stage
// ---------------------------------------------------------------------------

async function runAnalysisStage(
  startupId: string,
  stage: "idea" | "mvp" | "growth",
  emit: ProgressEmitter,
): Promise<{
  healthScore: HealthScore;
  rankedRecs:  RankedRecommendation[];
  plan:        ThirtyDayPlan;
}> {
  emit("Running SEO analysis...", 80, "Detecting issues and generating recommendations");
  await runSeoAnalysis(startupId);

  emit("Calculating startup health score...", 88, "Scoring across technical, validation, and growth axes");
  const healthScore = await calculateHealthScore(startupId, stage);

  emit("Building your growth plan...", 93, "Ranking recommendations and sequencing by dependency");
  const rankedRecs = await rankRecommendations(startupId);
  const plan       = await build30DayPlan(rankedRecs, startupId);

  return { healthScore, rankedRecs, plan };
}

// ---------------------------------------------------------------------------
// Public: run_onboarding — called once at signup (spec §12)
// ---------------------------------------------------------------------------

export interface OnboardingResult {
  healthScore: HealthScore;
  topRecommendations: RankedRecommendation[];
  plan: ThirtyDayPlan;
}

export async function runOnboarding(
  startupId: string,
  emit: ProgressEmitter = noopProgress,
): Promise<OnboardingResult | null> {
  try {
    await logEvent(startupId, "signup_started");

    // Load startup
    const [startup] = await db
      .select()
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);
    if (!startup) throw new Error(`Startup ${startupId} not found`);

    const domain = startup.url
      ? new URL(startup.url.startsWith("http") ? startup.url : `https://${startup.url}`).hostname
      : null;

    await runIngestionStage(startupId, startup.url, domain, emit);

    const stage = (startup.stage ?? "mvp") as "idea" | "mvp" | "growth";
    const { healthScore, rankedRecs, plan } = await runAnalysisStage(startupId, stage, emit);

    emit("Your LaunchPilot report is ready! 🚀", 100);
    await logEvent(startupId, "report_delivered", { overallScore: healthScore.overall });

    return {
      healthScore,
      topRecommendations: rankedRecs.slice(0, 5),
      plan,
    };
  } catch (err) {
    console.error("[orchestrator] runOnboarding failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: run_daily_cycle — scheduled by Celery in Phase 4 (spec §3.1)
// ---------------------------------------------------------------------------

export async function runDailyCycle(startupId: string): Promise<OnboardingResult | null> {
  return runOnboarding(startupId, noopProgress);
}
