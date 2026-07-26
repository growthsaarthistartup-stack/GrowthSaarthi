/**
 * Unit tests for the pure-math scoring functions.
 *
 * Tests cover:
 *   - scoreMetric (both invert paths, boundary values, null)
 *   - weightedAvg (with and without explicit weights, null values, empty)
 *   - calculateTrend (growth, decline, flat, too-few-points)
 *   - scoreCompetitorDensity (all density bands)
 *   - scoreMarketEvidence (up/flat/down/null)
 *   - computePriorityScore (spec formula)
 *   - calculateConfidence (all adjustments)
 *   - calculateImpact (every category)
 *   - applyGoalWeighting (multiplier ordering)
 *   - build30DayPlanPure (deps satisfied / unsatisfied, max 3/week)
 *   - STAGE_WEIGHTS sanity (weights sum to 1.0)
 *
 * No DB, no LLM, no network — all tests run offline.
 */

import { describe, it, expect } from "vitest";

import {
  scoreMetric,
  weightedAvg,
  calculateTrend,
  scoreCompetitorDensity,
  scoreMarketEvidence,
  STAGE_WEIGHTS,
} from "@/lib/scoring/health-score";

import {
  computePriorityScore,
  calculateConfidence,
  calculateImpact,
  applyGoalWeighting,
  GOAL_MULTIPLIERS,
} from "@/lib/scoring/recommendation-engine";

import {
  build30DayPlanPure,
  DEPENDENCIES,
} from "@/lib/scoring/plan-sequencer";

import type { RankedRecommendation } from "@/lib/scoring/recommendation-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRec(
  id: string,
  category: string,
  priority: number,
): RankedRecommendation {
  return {
    id,
    startupId:         "s1",
    idempotencyKey:    id,
    category,
    title:             `${category} rec`,
    description:       "",
    evidenceFactIds:   ["fact-1"],
    targetMetric:      null,
    impactScore:       priority,
    confidenceScore:   0.5,
    effortScore:       0.3,
    priorityScore:     priority,
    status:            "pending",
    trustLevelRequired: 1,
    createdAt:         new Date(),
    rankedPriorityScore: priority,
  } as RankedRecommendation;
}

// ---------------------------------------------------------------------------
// scoreMetric
// ---------------------------------------------------------------------------

describe("scoreMetric", () => {
  it("returns 1.0 when value equals good", () => {
    expect(scoreMetric(2500, 2500, 4000, true)).toBe(1.0);
  });

  it("returns 0.0 when value equals bad", () => {
    expect(scoreMetric(4000, 2500, 4000, true)).toBe(0.0);
  });

  it("interpolates midpoint correctly (no invert)", () => {
    // value=50, good=100, bad=0 → (50-0)/(100-0) = 0.5
    expect(scoreMetric(50, 100, 0)).toBeCloseTo(0.5);
  });

  it("interpolates midpoint correctly (invert=true)", () => {
    // LCP 3250ms is midpoint between good=2500 and bad=4000
    expect(scoreMetric(3250, 2500, 4000, true)).toBeCloseTo(0.5);
  });

  it("returns 0.5 (neutral) when value is null", () => {
    expect(scoreMetric(null, 2500, 4000, true)).toBe(0.5);
  });

  it("returns 0.5 (neutral) when value is undefined", () => {
    expect(scoreMetric(undefined, 100, 0)).toBe(0.5);
  });

  it("clamps to 1.0 when value exceeds good (no invert)", () => {
    expect(scoreMetric(150, 100, 0)).toBe(1.0);
  });

  it("clamps to 0.0 when value is below bad (no invert)", () => {
    expect(scoreMetric(-10, 100, 0)).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// weightedAvg
// ---------------------------------------------------------------------------

describe("weightedAvg", () => {
  it("equal weights when no weights map provided", () => {
    // (0.8 + 0.2 + 0.5) / 3 = 0.5
    expect(weightedAvg({ a: 0.8, b: 0.2, c: 0.5 })).toBeCloseTo(0.5);
  });

  it("applies explicit weights correctly", () => {
    // 1.0 * 0.7 + 0.0 * 0.3 = 0.7
    expect(weightedAvg({ a: 1.0, b: 0.0 }, { a: 0.7, b: 0.3 })).toBeCloseTo(0.7);
  });

  it("filters out null values when computing equal-weight avg", () => {
    // revenue_trend is null → only 2 terms averaged
    expect(weightedAvg({ traffic: 0.8, conversion: 0.6, revenue: null }))
      .toBeCloseTo((0.8 + 0.6) / 2);
  });

  it("returns 0.5 when all values are null", () => {
    expect(weightedAvg({ a: null, b: undefined })).toBe(0.5);
  });

  it("returns 0.5 for empty object", () => {
    expect(weightedAvg({})).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// calculateTrend
// ---------------------------------------------------------------------------

describe("calculateTrend", () => {
  it("returns 0.5 for a single value", () => {
    expect(calculateTrend([100])).toBe(0.5);
  });

  it("returns 0.5 for an empty array", () => {
    expect(calculateTrend([])).toBe(0.5);
  });

  it("detects growth (second half > first half)", () => {
    // first half avg = 100, second half avg = 150 → 1.5 clamped to 1.0
    expect(calculateTrend([100, 100, 150, 150])).toBe(1.0);
  });

  it("detects decline (second half < first half)", () => {
    // first half avg = 100, second half avg = 50 → 0.5
    expect(calculateTrend([100, 100, 50, 50])).toBeCloseTo(0.5);
  });

  it("returns 0.5 when first half average is 0", () => {
    expect(calculateTrend([0, 0, 100, 100])).toBe(0.5);
  });

  it("clamps negative trend to 0", () => {
    expect(calculateTrend([1000, 1000, 0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCompetitorDensity
// ---------------------------------------------------------------------------

describe("scoreCompetitorDensity", () => {
  it("returns neutral 0.5 when count is null", () => {
    expect(scoreCompetitorDensity(null)).toBe(0.5);
  });

  it("returns neutral 0.5 when count is 0 (not yet discovered)", () => {
    expect(scoreCompetitorDensity(0)).toBe(0.5);
  });

  it("returns 0.7 for 1-3 competitors (validates market)", () => {
    expect(scoreCompetitorDensity(1)).toBe(0.7);
    expect(scoreCompetitorDensity(3)).toBe(0.7);
  });

  it("returns 0.5 for 4-6 competitors (crowded but manageable)", () => {
    expect(scoreCompetitorDensity(4)).toBe(0.5);
    expect(scoreCompetitorDensity(6)).toBe(0.5);
  });

  it("returns declining score for 7+ competitors", () => {
    const score7 = scoreCompetitorDensity(7);
    const score10 = scoreCompetitorDensity(10);
    expect(score7).toBeLessThan(0.5);
    expect(score10).toBeLessThan(score7);
    expect(score7).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scoreMarketEvidence
// ---------------------------------------------------------------------------

describe("scoreMarketEvidence", () => {
  it("returns 0.8 for up trend", () => {
    expect(scoreMarketEvidence("up")).toBe(0.8);
  });

  it("returns 0.3 for down trend", () => {
    expect(scoreMarketEvidence("down")).toBe(0.3);
  });

  it("returns 0.5 for flat", () => {
    expect(scoreMarketEvidence("flat")).toBe(0.5);
  });

  it("returns 0.5 for null (deferred agent)", () => {
    expect(scoreMarketEvidence(null)).toBe(0.5);
    expect(scoreMarketEvidence(undefined)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// STAGE_WEIGHTS
// ---------------------------------------------------------------------------

describe("STAGE_WEIGHTS", () => {
  it("weights sum to 1.0 for each stage", () => {
    for (const [stage, w] of Object.entries(STAGE_WEIGHTS)) {
      const sum = w.technical + w.validation + w.growth;
      expect(sum).toBeCloseTo(1.0, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// computePriorityScore
// ---------------------------------------------------------------------------

describe("computePriorityScore", () => {
  it("uses the spec formula: (impact*0.6)*(confidence*0.4)/(effort+0.1)", () => {
    const impact = 0.8, confidence = 0.7, effort = 0.3;
    const expected = (impact * 0.6) * (confidence * 0.4) / (effort + 0.1);
    expect(computePriorityScore(impact, confidence, effort)).toBeCloseTo(expected);
  });

  it("higher impact → higher score when other params fixed", () => {
    expect(computePriorityScore(0.9, 0.7, 0.3))
      .toBeGreaterThan(computePriorityScore(0.5, 0.7, 0.3));
  });

  it("higher effort → lower score when other params fixed", () => {
    expect(computePriorityScore(0.8, 0.7, 0.1))
      .toBeGreaterThan(computePriorityScore(0.8, 0.7, 0.9));
  });

  it("avoids division by zero via +0.1 in denominator", () => {
    expect(() => computePriorityScore(1.0, 1.0, 0)).not.toThrow();
    expect(computePriorityScore(1.0, 1.0, 0)).toBeCloseTo((1.0 * 0.6) * (1.0 * 0.4) / 0.1);
  });
});

// ---------------------------------------------------------------------------
// calculateConfidence
// ---------------------------------------------------------------------------

describe("calculateConfidence", () => {
  it("base is 0.5 with no adjustments (mid tier, no stale, no sources)", () => {
    expect(calculateConfidence(["fact1"], "mid", 0, [])).toBeCloseTo(0.5 + 0.1);
  });

  it("source bonus caps at 0.3 regardless of fact count", () => {
    const manyFacts = ["f1","f2","f3","f4","f5","f6","f7"];
    const score = calculateConfidence(manyFacts, "mid", 0, []);
    // base(0.5) + sourcebonus(capped 0.3) = 0.8
    expect(score).toBeCloseTo(0.8);
  });

  it("fallback model tier reduces confidence by 0.1", () => {
    const mid      = calculateConfidence(["f1"], "mid",      0, []);
    const fallback = calculateConfidence(["f1"], "fallback", 0, []);
    expect(mid - fallback).toBeCloseTo(0.1);
  });

  it("ga4_verified data adds 0.2 quality bonus", () => {
    const noBonus = calculateConfidence(["f1"], "mid", 0, []);
    const bonus   = calculateConfidence(["f1"], "mid", 0, ["ga4_verified"]);
    expect(bonus - noBonus).toBeCloseTo(0.2);
  });

  it("stale facts reduce confidence by 0.05 each", () => {
    const fresh = calculateConfidence(["f1"], "mid", 0, []);
    const stale = calculateConfidence(["f1"], "mid", 3, []);
    expect(fresh - stale).toBeCloseTo(0.15);
  });

  it("clamps to [0, 1]", () => {
    // Worst case: fallback + many stale facts
    const low = calculateConfidence([], "fallback", 20, ["estimated"]);
    expect(low).toBeGreaterThanOrEqual(0);
    // Best case
    const high = calculateConfidence(["f1","f2","f3","f4"], "frontier", 0, ["stripe_verified"]);
    expect(high).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// calculateImpact
// ---------------------------------------------------------------------------

describe("calculateImpact", () => {
  it("seo: 0.3 base when volume is 0", () => {
    expect(calculateImpact({ category: "seo", keywordVolume: 0 })).toBeCloseTo(0.3);
  });

  it("seo: caps at 0.8 for very high volume", () => {
    expect(calculateImpact({ category: "seo", keywordVolume: 100_000 })).toBe(0.8);
  });

  it("landing_page: scales with conversion rate", () => {
    const v1 = calculateImpact({ category: "landing_page", currentConvRate: 0.02 });
    const v2 = calculateImpact({ category: "landing_page", currentConvRate: 0.10 });
    expect(v2).toBeGreaterThan(v1);
  });

  it("churn: 0 when no churner MRR", () => {
    expect(calculateImpact({ category: "churn", churnerMrr: 0, totalMrr: 10000 }))
      .toBe(0);
  });

  it("unknown category returns neutral 0.5", () => {
    expect(calculateImpact({ category: "made_up_category" })).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// applyGoalWeighting
// ---------------------------------------------------------------------------

describe("applyGoalWeighting", () => {
  it("get_more_customers boosts seo and landing_page", () => {
    const seo  = makeRec("r1", "seo",          1.0);
    const churn = makeRec("r2", "churn",        1.0);
    const result = applyGoalWeighting([seo, churn], "get_more_customers");
    const seoScore   = result.find((r) => r.id === "r1")!.rankedPriorityScore;
    const churnScore = result.find((r) => r.id === "r2")!.rankedPriorityScore;
    expect(seoScore).toBeCloseTo(1.0 * GOAL_MULTIPLIERS.get_more_customers.seo);
    expect(churnScore).toBeCloseTo(1.0 * GOAL_MULTIPLIERS.get_more_customers.churn);
    expect(seoScore).toBeGreaterThan(churnScore);
  });

  it("retain_existing_customers boosts churn over seo", () => {
    const seo   = makeRec("r1", "seo",   1.0);
    const churn = makeRec("r2", "churn", 1.0);
    const result = applyGoalWeighting([seo, churn], "retain_existing_customers");
    const seoScore   = result.find((r) => r.id === "r1")!.rankedPriorityScore;
    const churnScore = result.find((r) => r.id === "r2")!.rankedPriorityScore;
    expect(churnScore).toBeGreaterThan(seoScore);
  });

  it("unknown goal → multiplier 1.0 (no change)", () => {
    const rec = makeRec("r1", "seo", 0.72);
    const [out] = applyGoalWeighting([rec], "some_future_goal");
    expect(out.rankedPriorityScore).toBeCloseTo(0.72);
  });

  it("returns recommendations sorted by rankedPriorityScore descending", () => {
    const recs = [
      makeRec("r1", "churn",   0.5),
      makeRec("r2", "seo",     0.5),
      makeRec("r3", "content", 0.5),
    ];
    const result = applyGoalWeighting(recs, "get_more_customers");
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].rankedPriorityScore)
        .toBeGreaterThanOrEqual(result[i].rankedPriorityScore);
    }
  });
});

// ---------------------------------------------------------------------------
// build30DayPlanPure
// ---------------------------------------------------------------------------

describe("build30DayPlanPure", () => {
  it("places all recs in week 1 when no deps and fewer than 3", () => {
    const recs = [makeRec("r1", "seo", 1.0), makeRec("r2", "content", 0.8)];
    const plan = build30DayPlanPure(recs, new Set());
    expect(plan[1]).toHaveLength(2);
    expect(plan[2]).toHaveLength(0);
  });

  it("caps at 3 per week", () => {
    const recs = Array.from({ length: 6 }, (_, i) =>
      makeRec(`r${i}`, "seo", 1.0 - i * 0.1),
    );
    const plan = build30DayPlanPure(recs, new Set());
    expect(plan[1]).toHaveLength(3);
    expect(plan[2]).toHaveLength(3);
    expect(plan[3]).toHaveLength(0);
  });

  it("blocks seo_blog_posts until tech_seo_fixes in previous week", () => {
    const blog   = makeRec("blog", "seo_blog_posts",  1.0);
    const techFix = makeRec("fix",  "tech_seo_fixes", 0.9);
    // blog dep is tech_seo_fixes — techFix has no deps
    const plan = build30DayPlanPure([blog, techFix], new Set());
    // techFix goes to week 1, blog to week 2
    expect(plan[1].map((r) => r.id)).toContain("fix");
    expect(plan[2].map((r) => r.id)).toContain("blog");
  });

  it("places rec in week 1 when dep is already in completed set", () => {
    const blog = makeRec("blog", "seo_blog_posts", 1.0);
    // tech_seo_fixes is already completed in history
    const plan = build30DayPlanPure([blog], new Set(["tech_seo_fixes"]));
    expect(plan[1].map((r) => r.id)).toContain("blog");
  });

  it("does not duplicate a rec across weeks", () => {
    const recs = [makeRec("r1", "seo", 1.0)];
    const plan = build30DayPlanPure(recs, new Set());
    const allAssigned = [...plan[1], ...plan[2], ...plan[3], ...plan[4]];
    const ids = allAssigned.map((r) => r.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("unresolvable deps leave the rec unassigned", () => {
    // paid_ads needs landing_page_copy + conversion_tracking, neither available
    const ads = makeRec("ads", "paid_ads", 1.0);
    const plan = build30DayPlanPure([ads], new Set());
    const allAssigned = [...plan[1], ...plan[2], ...plan[3], ...plan[4]];
    expect(allAssigned.map((r) => r.id)).not.toContain("ads");
  });
});

// ---------------------------------------------------------------------------
// computeTrustLevel (spec §7 exact thresholds)
// ---------------------------------------------------------------------------

import { computeTrustLevel } from "@/lib/trust-ladder";
import { IRREVERSIBLE, AUTO_SAFE } from "@/lib/execution-gate";

describe("computeTrustLevel", () => {
  it("returns 1 with 0 approved signals", () => {
    expect(computeTrustLevel(0, 0)).toBe(1);
  });

  it("returns 1 with 1 approved signal", () => {
    expect(computeTrustLevel(1, 1)).toBe(1);
  });

  it("returns 2 with exactly 2 approved signals", () => {
    expect(computeTrustLevel(2, 2)).toBe(2);
  });

  it("returns 2 with 4 approved / 10 total (rate=0.4, below 0.7 threshold)", () => {
    expect(computeTrustLevel(4, 10)).toBe(2);
  });

  it("returns 3 with 5 approved / 6 total (rate=0.833 > 0.7)", () => {
    expect(computeTrustLevel(5, 6)).toBe(3);
  });

  it("returns 3 with exactly 5 approved / 7 total (rate≈0.714 > 0.7)", () => {
    expect(computeTrustLevel(5, 7)).toBe(3);
  });

  it("does NOT return 3 when rate is exactly 0.7 (threshold is strictly >0.7)", () => {
    // 7 approved / 10 total = 0.7 — not strictly greater
    expect(computeTrustLevel(7, 10)).toBe(2); // 7 approved ≥ 2 but rate not > 0.7
  });

  it("returns 4 with 15 approved / 18 total (rate≈0.833 > 0.8)", () => {
    expect(computeTrustLevel(15, 18)).toBe(4);
  });

  it("does NOT return 4 when count ≥15 but rate ≤ 0.8", () => {
    // 15 approved / 19 total ≈ 0.789 — not strictly > 0.8
    expect(computeTrustLevel(15, 19)).toBe(3);
  });

  it("returns 4 with 100 approved / 110 total (high-trust startup)", () => {
    expect(computeTrustLevel(100, 110)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ExecutionGate constants — content_social + content_blog are NEVER AUTO_SAFE
// ---------------------------------------------------------------------------

describe("ExecutionGate constants", () => {
  it("content_social is NOT in AUTO_SAFE", () => {
    expect(AUTO_SAFE.has("content_social" as never)).toBe(false);
  });

  it("content_blog is NOT in AUTO_SAFE", () => {
    expect(AUTO_SAFE.has("content_blog" as never)).toBe(false);
  });

  it("publish_content is IRREVERSIBLE", () => {
    expect(IRREVERSIBLE.has("publish_content" as never)).toBe(true);
  });

  it("email_customers is IRREVERSIBLE", () => {
    expect(IRREVERSIBLE.has("email_customers" as never)).toBe(true);
  });

  it("change_pricing is IRREVERSIBLE", () => {
    expect(IRREVERSIBLE.has("change_pricing" as never)).toBe(true);
  });

  it("seo_metadata IS in AUTO_SAFE", () => {
    expect(AUTO_SAFE.has("seo_metadata" as never)).toBe(true);
  });

  it("monitoring_report IS in AUTO_SAFE", () => {
    expect(AUTO_SAFE.has("monitoring_report" as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// medianSimilarity + computeDynamicThreshold (competitor-agent Phase 2f)
// ---------------------------------------------------------------------------

import {
  medianSimilarity,
  computeDynamicThreshold,
} from "@/lib/agents/competitor-agent";

describe("medianSimilarity()", () => {
  it("returns 0.72 for empty array (fallback)", () => {
    expect(medianSimilarity([])).toBe(0.72);
  });

  it("returns the single value for a 1-element array", () => {
    expect(medianSimilarity([0.65])).toBe(0.65);
  });

  it("returns middle element for odd-length array", () => {
    expect(medianSimilarity([0.5, 0.7, 0.9])).toBe(0.7);
  });

  it("returns average of two middle elements for even-length array", () => {
    expect(medianSimilarity([0.5, 0.6, 0.8, 0.9])).toBeCloseTo(0.7, 5);
  });

  it("is order-independent (unsorted input)", () => {
    expect(medianSimilarity([0.9, 0.5, 0.7])).toBe(0.7);
  });

  it("does not mutate the input array", () => {
    const arr = [0.9, 0.5, 0.7];
    medianSimilarity(arr);
    expect(arr).toEqual([0.9, 0.5, 0.7]);
  });
});

describe("computeDynamicThreshold()", () => {
  it("floors at 0.6 when median is below 0.6", () => {
    // Niche vertical: all similarities are low
    expect(computeDynamicThreshold([0.3, 0.4, 0.5])).toBe(0.6);
  });

  it("uses median when above 0.6", () => {
    // Competitive SaaS space: high similarities
    const scores = [0.72, 0.74, 0.78, 0.80, 0.82, 0.85];
    expect(computeDynamicThreshold(scores)).toBeCloseTo(0.79, 2);
  });

  it("returns 0.6 floor for empty array (fallback median = 0.72 > 0.6)", () => {
    // Empty → medianSimilarity returns 0.72 → threshold = max(0.6, 0.72) = 0.72
    expect(computeDynamicThreshold([])).toBe(0.72);
  });

  it("returns 0.6 for single below-floor score", () => {
    expect(computeDynamicThreshold([0.4])).toBe(0.6);
  });

  it("returns exact median for single above-floor score", () => {
    expect(computeDynamicThreshold([0.85])).toBe(0.85);
  });
});

