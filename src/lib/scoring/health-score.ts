/**
 * Health Score Calculator — pure math, zero LLM calls (spec §3.6).
 *
 * score_metric() matches the spec exactly:
 *   if invert: value, good, bad = -value, -good, -bad
 *   if value >= good: return 1.0
 *   if value <= bad:  return 0.0
 *   else: return (value - bad) / (good - bad)
 *
 * Missing MarketSignal / Customer data → neutral 0.5, never 0, never throws.
 * validation and growth use equal weights when no weight map is supplied (spec
 * calls weighted_avg(validation) and weighted_avg(growth) without a weights arg).
 *
 * Pure functions (scoreMetric, weightedAvg, calculateTrend) are exported
 * so unit tests can reach them without touching the DB.
 */

import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  websiteScans,
  metrics,
  competitors,
  marketSignals,
  customers,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Exported pure functions (spec §3.6) — unit-testable, no I/O
// ---------------------------------------------------------------------------

/**
 * score_metric — linear interpolation, exact spec implementation.
 * When invert=true the negation is applied to all three values, not branched.
 * Returns 0.5 (neutral) when value is null/undefined — never 0.
 */
export function scoreMetric(
  value: number | null | undefined,
  good: number,
  bad: number,
  invert = false,
): number {
  if (value == null) return 0.5;
  let v = value, g = good, b = bad;
  if (invert) { v = -v; g = -g; b = -b; }
  if (v >= g) return 1.0;
  if (v <= b) return 0.0;
  return (v - b) / (g - b);
}

/**
 * weighted_avg — when weights is omitted every key gets equal weight.
 * Returns 0.5 when the values map is empty (deferred agents).
 */
export function weightedAvg(
  values: Record<string, number | null | undefined>,
  weights?: Record<string, number>,
): number {
  const entries = Object.entries(values).filter(([, v]) => v != null) as [string, number][];
  if (entries.length === 0) return 0.5;

  const equalW = 1 / entries.length;
  let total = 0, totalWeight = 0;
  for (const [key, val] of entries) {
    const w = weights ? (weights[key] ?? 0) : equalW;
    total       += val * w;
    totalWeight += w;
  }
  return totalWeight === 0 ? 0.5 : total / totalWeight;
}

/**
 * calculate_trend — ratio of second-half avg to first-half avg, clamped [0, 1].
 * Returns 0.5 when fewer than 2 data points exist.
 */
export function calculateTrend(values: number[]): number {
  if (values.length < 2) return 0.5;
  const mid   = Math.floor(values.length / 2);
  const first  = values.slice(0, mid);
  const second = values.slice(mid);
  const avgFirst  = first.reduce((a, b) => a + b, 0)  / first.length;
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
  if (avgFirst === 0) return 0.5;
  return Math.min(1, Math.max(0, avgSecond / avgFirst));
}

/** score_competitor_density — 0 → neutral; 1-3 validates market; 7+ crowded. */
export function scoreCompetitorDensity(count: number | null): number {
  if (count == null || count === 0) return 0.5;
  if (count <= 3) return 0.7;
  if (count <= 6) return 0.5;
  return Math.max(0.1, 0.5 - (count - 6) * 0.05);
}

/** score_market_evidence — from MarketSignal.categoryTrendDirection. */
export function scoreMarketEvidence(direction: string | null | undefined): number {
  if (direction === "up")   return 0.8;
  if (direction === "down") return 0.3;
  return 0.5; // "flat" or absent → neutral
}

/** score_pricing — placeholder; uses neutral until CompetitorScan has pricing tiers. */
export function scorePricing(
  competitorPricingTiers: string[] | null,
  ownPricingTiers: string[] | null,
): number {
  if (!competitorPricingTiers || !ownPricingTiers) return 0.5;
  const ratio = ownPricingTiers.length / Math.max(competitorPricingTiers.length, 1);
  if (ratio >= 0.8 && ratio <= 1.2) return 0.8;
  if (ratio < 0.5) return 0.4;
  return 0.6;
}

// ---------------------------------------------------------------------------
// Stage weights — exact spec table (spec §3.6)
// ---------------------------------------------------------------------------

export const STAGE_WEIGHTS: Record<string, { technical: number; validation: number; growth: number }> = {
  idea:   { technical: 0.15, validation: 0.60, growth: 0.25 },
  mvp:    { technical: 0.20, validation: 0.45, growth: 0.35 },
  growth: { technical: 0.25, validation: 0.15, growth: 0.60 },
};

// Technical sub-score weights — spec §3.6
const TECHNICAL_WEIGHTS = {
  lcp:            0.30,
  cls:            0.20,
  has_sitemap:    0.10,
  has_meta_desc:  0.15,
  mobile_friendly: 0.15,
  broken_links:   0.10,
};

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface HealthScore {
  overall:    number; // 0–100
  technical:  number; // 0–100
  validation: number; // 0–100
  growth:     number; // 0–100
  explainability: {
    technicalBreakdown:  Record<string, number>;
    validationBreakdown: Record<string, number | null | undefined>;
    growthBreakdown:     Record<string, number | null | undefined>;
  };
}

// ---------------------------------------------------------------------------
// Main export — async DB reads, delegates math to pure functions above
// ---------------------------------------------------------------------------

export async function calculateHealthScore(
  startupId: string,
  stage: "idea" | "mvp" | "growth",
): Promise<HealthScore> {
  const stageWeights = STAGE_WEIGHTS[stage] ?? STAGE_WEIGHTS.mvp;

  // ── Technical ────────────────────────────────────────────────────────────
  const [scan] = await db
    .select()
    .from(websiteScans)
    .where(eq(websiteScans.startupId, startupId))
    .orderBy(desc(websiteScans.createdAt))
    .limit(1);

  const technical: Record<string, number> = {
    lcp: scoreMetric(scan?.lcpMs, 2500, 4000, /* invert */ true),
    cls: scoreMetric(scan?.clsScore, 0.1, 0.25, true),
    has_sitemap:    scan ? (scan.hasSitemap ? 1.0 : 0.0) : 0.5,
    has_meta_desc:  scan ? (scan.metaDescription ? 1.0 : 0.2) : 0.5,
    mobile_friendly: scan?.mobileScore != null
      ? (scan.mobileScore > 90 ? 1.0 : scan.mobileScore / 100)
      : 0.5,
    broken_links: scan
      ? (!scan.brokenLinks?.length ? 1.0 : Math.max(0, 1 - scan.brokenLinks.length / 10))
      : 0.5,
  };
  const technicalScore = weightedAvg(technical, TECHNICAL_WEIGHTS);

  // ── Validation ───────────────────────────────────────────────────────────
  // competitor_density
  const compRows = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(eq(competitors.startupId, startupId));
  const competitorDensity = scoreCompetitorDensity(compRows.length);

  // market_evidence — deferred agent → neutral when no rows exist
  const [mkt] = await db
    .select({ categoryTrendDirection: marketSignals.categoryTrendDirection })
    .from(marketSignals)
    .where(eq(marketSignals.startupId, startupId))
    .orderBy(desc(marketSignals.createdAt))
    .limit(1);
  const marketEvidence = scoreMarketEvidence(mkt?.categoryTrendDirection);

  // pricing_viability — compare competitor pricing tiers vs own (from WebsiteScan context)
  const compPricingRows = await db
    .select({ pricingTiers: competitors.pricingTiers })
    .from(competitors)
    .where(eq(competitors.startupId, startupId))
    .limit(5);
  const allCompTiers = compPricingRows.flatMap((c) => c.pricingTiers ?? []);
  const pricingViability = scorePricing(
    allCompTiers.length ? allCompTiers : null,
    null, // own pricing not scraped yet → neutral
  );

  // early_feedback — deferred → neutral when no Customer rows
  const [cust] = await db
    .select({ sentimentScore: customers.sentimentScore })
    .from(customers)
    .where(eq(customers.startupId, startupId))
    .orderBy(desc(customers.createdAt))
    .limit(1);
  const earlyFeedback: number = cust?.sentimentScore ?? 0.5;

  const validation: Record<string, number | null | undefined> = {
    market_evidence:    marketEvidence,
    competitor_density: competitorDensity,
    pricing_viability:  pricingViability,
    early_feedback:     earlyFeedback,
  };
  // spec calls weighted_avg(validation) — no weights arg → equal weights
  const validationScore = weightedAvg(validation);

  // ── Growth ───────────────────────────────────────────────────────────────
  const metricRows = await db
    .select({ type: metrics.type, value: metrics.value, date: metrics.date })
    .from(metrics)
    .where(eq(metrics.startupId, startupId))
    .orderBy(desc(metrics.createdAt))
    .limit(60);

  const sessionVals    = metricRows.filter((m) => m.type === "sessions")
    .map((m) => m.value).reverse();
  const convVals       = metricRows.filter((m) => m.type === "conversions")
    .map((m) => m.value).reverse();
  const revenueVals    = metricRows.filter((m) => m.type === "mrr")
    .map((m) => m.value).reverse();

  const growth: Record<string, number | null | undefined> = {
    traffic_trend:    sessionVals.length  >= 2 ? calculateTrend(sessionVals)  : 0.5,
    conversion_trend: convVals.length     >= 2 ? calculateTrend(convVals)     : 0.5,
    // revenue_trend: null when no Stripe metrics yet → filtered out by weightedAvg
    revenue_trend:    revenueVals.length  >= 2 ? calculateTrend(revenueVals)  : null,
  };
  // spec calls weighted_avg(growth) — equal weights across non-null keys
  const growthScore = weightedAvg(growth);

  // ── Overall ──────────────────────────────────────────────────────────────
  const overall =
    (technicalScore  * stageWeights.technical +
     validationScore * stageWeights.validation +
     growthScore     * stageWeights.growth) * 100;

  return {
    overall:    Math.round(overall * 10) / 10,
    technical:  Math.round(technicalScore  * 1000) / 10,
    validation: Math.round(validationScore * 1000) / 10,
    growth:     Math.round(growthScore     * 1000) / 10,
    explainability: {
      technicalBreakdown:  technical,
      validationBreakdown: validation,
      growthBreakdown:     growth,
    },
  };
}
