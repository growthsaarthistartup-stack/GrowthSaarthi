/**
 * Recommendation Engine — exact spec §6 implementation.
 *
 * Formula (spec §6):
 *   priority_score = (impact × 0.6) × (confidence × 0.4) / (effort + 0.1)
 *                  ← note: multiply the two terms, then divide by effort
 *
 * Per-category impact formulas, confidence scoring with MODEL_TIER_CONFIDENCE
 * and DATA_QUALITY tables, and GOAL_MULTIPLIERS are all taken verbatim from
 * the spec. Pure scoring functions are exported for unit tests.
 *
 * DB constraint: evidence_fact_ids must not be empty. This is enforced at two
 * layers — the Drizzle schema (.notNull()) and a runtime assertion in writeRecommendation().
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations, metrics, startups } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// Exported pure functions — unit-testable, zero I/O
// ---------------------------------------------------------------------------

/** Exact spec §6 formula. */
export function computePriorityScore(
  impact: number,
  confidence: number,
  effort: number,
): number {
  return (impact * 0.6) * (confidence * 0.4) / (effort + 0.1);
}

// ---------------------------------------------------------------------------
// Per-category impact formulas (spec §6 table)
// ---------------------------------------------------------------------------

export interface ImpactContext {
  category:             string;
  keywordVolume?:       number; // for seo_fix / keyword_gap
  baselineSessions?:    number; // for seo_blog
  estimatedSessions?:   number; // for seo_blog
  currentConvRate?:     number; // for landing_page
  competitorTrafficShare?: number; // for competitor_gap
  churnerMrr?:          number; // for churn_fix
  totalMrr?:            number; // for churn_fix / payment_recovery
  failedAmount?:        number; // for payment_recovery
}

export function calculateImpact(ctx: ImpactContext): number {
  switch (ctx.category) {
    case "seo":
    case "seo_fix":
      return Math.min(0.3 + ((ctx.keywordVolume ?? 0) / 50_000), 0.8);

    case "content":
    case "seo_blog": {
      const base    = ctx.baselineSessions ?? 1;
      const est     = ctx.estimatedSessions ?? 0;
      return Math.min((est / base) * 0.5, 1.0);
    }

    case "landing_page":
      return Math.min((ctx.currentConvRate ?? 0.02) * 0.2, 1.0);

    case "competitor_gap":
      return Math.min((ctx.competitorTrafficShare ?? 0) * 0.4, 1.0);

    case "churn":
    case "retention": {
      const mrr = ctx.totalMrr ?? 1;
      return Math.min(((ctx.churnerMrr ?? 0) / mrr) * 0.8, 1.0);
    }

    case "payment_recovery": {
      const mrr = ctx.totalMrr ?? 1;
      return Math.min(((ctx.failedAmount ?? 0) / mrr) * 0.9, 1.0);
    }

    default:
      return 0.5; // unknown category — neutral impact
  }
}

// ---------------------------------------------------------------------------
// Confidence scoring (spec §6)
// ---------------------------------------------------------------------------

export const MODEL_TIER_CONFIDENCE: Record<string, number> = {
  frontier: 0.05,
  mid:      0.0,
  fallback: -0.1,
};

export const DATA_QUALITY: Record<string, number> = {
  ga4_verified:    0.2,
  stripe_verified: 0.25,
  scraped:         0.05,
  estimated:       -0.1,
};

export function calculateConfidence(
  evidenceFactIds: string[],
  modelTier: "frontier" | "mid" | "fallback",
  staleFactCount: number,
  dataSourceQualifiers: string[],
): number {
  const base          = 0.5;
  const sourceBonus   = Math.min(evidenceFactIds.length * 0.1, 0.3);
  const qualityBonus  = dataSourceQualifiers.reduce(
    (acc, s) => acc + (DATA_QUALITY[s] ?? 0), 0,
  );
  const recencyPenalty = -0.05 * staleFactCount;
  const tierAdjust     = MODEL_TIER_CONFIDENCE[modelTier] ?? 0;
  return Math.min(Math.max(base + sourceBonus + qualityBonus + recencyPenalty + tierAdjust, 0), 1);
}

// ---------------------------------------------------------------------------
// Goal multipliers (spec §6)
// ---------------------------------------------------------------------------

export const GOAL_MULTIPLIERS: Record<string, Record<string, number>> = {
  get_more_customers: {
    seo:            1.4,
    content:        1.3,
    landing_page:   1.5,
    competitor_gap: 1.2,
    retention:      0.7,
    churn:          0.8,
  },
  retain_existing_customers: {
    seo:          0.8,
    content:      0.9,
    churn:        1.6,
    retention:    1.5,
    onboarding:   1.4,
    landing_page: 0.9,
  },
};

export function applyGoalWeighting(
  recs: RankedRecommendation[],
  primaryGoal: string,
): RankedRecommendation[] {
  const multipliers = GOAL_MULTIPLIERS[primaryGoal] ?? {};
  const weighted = recs.map((rec) => ({
    ...rec,
    rankedPriorityScore: rec.rankedPriorityScore * (multipliers[rec.category] ?? 1.0),
  }));
  return weighted.sort((a, b) => b.rankedPriorityScore - a.rankedPriorityScore);
}

// ---------------------------------------------------------------------------
// DB-layer write guard — enforces evidence_fact_ids at runtime (spec §4)
// ---------------------------------------------------------------------------

export type RecommendationRow    = typeof recommendations.$inferSelect;
export type RecommendationInsert = typeof recommendations.$inferInsert;

export async function writeRecommendation(
  data: Omit<RecommendationInsert, "id">,
): Promise<typeof recommendations.$inferSelect> {
  // Runtime assertion that mirrors the spec's GraphRepository constraint
  if (!data.evidenceFactIds || data.evidenceFactIds.length === 0) {
    throw new Error(
      `[recommendation-engine] Cannot create recommendation "${data.title}" ` +
      "without citing at least one graph fact (evidence_fact_ids must not be empty).",
    );
  }

  const [row] = await db
    .insert(recommendations)
    .values({ id: generateULID(), ...data })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Conflict — idempotency key already exists, fetch existing
    const [existing] = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.idempotencyKey, data.idempotencyKey ?? ""))
      .limit(1);
    if (!existing) throw new Error("writeRecommendation: insert failed and no existing row found");
    return existing;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Ranked recommendation type
// ---------------------------------------------------------------------------

export type RankedRecommendation = typeof recommendations.$inferSelect & {
  rankedPriorityScore: number;
};

// ---------------------------------------------------------------------------
// Main export — reads from DB, applies scoring + goal weighting
// ---------------------------------------------------------------------------

export async function rankRecommendations(startupId: string): Promise<RankedRecommendation[]> {
  const [startup] = await db
    .select()
    .from(startups)
    .where(eq(startups.id, startupId))
    .limit(1);
  const primaryGoal = startup?.primaryGoal ?? "get_more_customers";

  // All pending recommendations
  const recs = await db
    .select()
    .from(recommendations)
    .where(
      and(eq(recommendations.startupId, startupId), eq(recommendations.status, "pending")),
    )
    .orderBy(desc(recommendations.createdAt));

  // Determine data staleness + source quality for confidence adjustment
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const allMetrics = await db
    .select({ date: metrics.date, source: metrics.source })
    .from(metrics)
    .where(eq(metrics.startupId, startupId));

  const staleCount  = allMetrics.filter((m) => m.date < fourteenDaysAgo).length;
  const qualifiers  = [
    ...new Set(
      allMetrics.map((m) =>
        m.source === "ga4"    ? "ga4_verified"    :
        m.source === "stripe" ? "stripe_verified" : "estimated",
      ),
    ),
  ];

  // Score each recommendation
  const scored: RankedRecommendation[] = recs.map((rec) => {
    const confidence = calculateConfidence(
      rec.evidenceFactIds,
      "mid",          // all current agents use mid-tier models
      staleCount,
      qualifiers,
    );
    const priority = computePriorityScore(rec.impactScore, confidence, rec.effortScore);
    return { ...rec, confidenceScore: confidence, rankedPriorityScore: priority };
  });

  return applyGoalWeighting(scored, primaryGoal);
}
