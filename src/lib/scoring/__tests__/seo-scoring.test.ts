/**
 * Unit tests for SEO agent pure-math functions.
 *
 * These tests are fully deterministic — no DB connections, no LLM calls,
 * no network requests. Run with: npx vitest run
 */

import { describe, it, expect } from "vitest";

// Pure functions under test
import {
  computeSeoImpact,
  computeSeoConfidence,
  computeMobileDesktopGap,
  computeGeoScore,
  normalise,
} from "@/lib/agents/seo-analysis-agent";

import {
  detectColdStart,
  jaccardSimilarity,
  type ColdStartSignals,
} from "@/lib/agents/seo-agent";

import {
  isCacheHit,
  computeScanContentHash,
} from "@/lib/integrations/seo-score-api";

// ---------------------------------------------------------------------------
// normalise()
// ---------------------------------------------------------------------------

describe("normalise()", () => {
  it("returns 1.0 at max", () => expect(normalise(100, 0, 100)).toBe(1));
  it("returns 0.0 at min", () => expect(normalise(0, 0, 100)).toBe(0));
  it("returns 0.5 at midpoint", () => expect(normalise(50, 0, 100)).toBe(0.5));
  it("clamps below min to 0", () => expect(normalise(-10, 0, 100)).toBe(0));
  it("clamps above max to 1", () => expect(normalise(150, 0, 100)).toBe(1));
  it("returns 0.5 when min === max", () => expect(normalise(50, 50, 50)).toBe(0.5));
});

// ---------------------------------------------------------------------------
// computeSeoImpact()
// ---------------------------------------------------------------------------

describe("computeSeoImpact()", () => {
  it("returns 0-1 range for all inputs", () => {
    const result = computeSeoImpact({
      issueType: "keyword_gap_high_volume",
      searchVolume: 10_000,
      competitorCount: 3,
      technicalSeverity: 0.7,
    });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("higher volume → higher impact", () => {
    const low = computeSeoImpact({ issueType: "keyword_gap_high_volume", searchVolume: 100 });
    const high = computeSeoImpact({ issueType: "keyword_gap_high_volume", searchVolume: 40_000 });
    expect(high).toBeGreaterThan(low);
  });

  it("caps keyword_gap impact at 0.4 for cold_start sites", () => {
    const result = computeSeoImpact({
      issueType: "keyword_gap_high_volume",
      searchVolume: 50_000,
      competitorCount: 5,
      technicalSeverity: 0.9,
      isColdStart: true,
    });
    expect(result).toBeLessThanOrEqual(0.4);
  });

  it("boosts foundational issues for cold_start sites", () => {
    const baseResult = computeSeoImpact({
      issueType: "missing_sitemap",
      isColdStart: false,
    });
    const coldResult = computeSeoImpact({
      issueType: "missing_sitemap",
      isColdStart: true,
    });
    expect(coldResult).toBeGreaterThanOrEqual(baseResult);
  });

  it("uses technicalSeverity as a factor", () => {
    const lowSev  = computeSeoImpact({ issueType: "slow_lcp", technicalSeverity: 0.2 });
    const highSev = computeSeoImpact({ issueType: "slow_lcp", technicalSeverity: 0.9 });
    expect(highSev).toBeGreaterThan(lowSev);
  });

  it("competitive_gap capped for cold_start", () => {
    const result = computeSeoImpact({
      issueType: "competitive_gap_high_overlap",
      competitorCount: 5,
      isColdStart: true,
    });
    expect(result).toBeLessThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// computeSeoConfidence()
// ---------------------------------------------------------------------------

describe("computeSeoConfidence()", () => {
  it("returns 1.0 for GSC + live audit", () => {
    expect(computeSeoConfidence({ hasGsc: true, hasLiveAudit: true })).toBe(1.0);
  });

  it("returns 0.7 for GSC alone", () => {
    expect(computeSeoConfidence({ hasGsc: true, hasLiveAudit: false })).toBe(0.7);
  });

  it("returns 0.7 for live audit alone", () => {
    expect(computeSeoConfidence({ hasGsc: false, hasLiveAudit: true })).toBe(0.7);
  });

  it("returns 0.5 for serpapi_rank only", () => {
    expect(
      computeSeoConfidence({ hasGsc: false, hasLiveAudit: false, keywordConfidence: "serpapi_rank" }),
    ).toBe(0.5);
  });

  it("returns 0.5 for competitor_inferred only", () => {
    expect(
      computeSeoConfidence({ hasGsc: false, hasLiveAudit: false, keywordConfidence: "competitor_inferred" }),
    ).toBe(0.5);
  });

  it("applies feedbackBoost within [0, 1]", () => {
    const base = computeSeoConfidence({ hasGsc: true, hasLiveAudit: false });
    const boosted = computeSeoConfidence({ hasGsc: true, hasLiveAudit: false, feedbackBoost: 0.15 });
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(1.0);
  });

  it("never exceeds 1.0 with large feedbackBoost", () => {
    const result = computeSeoConfidence({ hasGsc: true, hasLiveAudit: true, feedbackBoost: 0.5 });
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// computeMobileDesktopGap()
// ---------------------------------------------------------------------------

describe("computeMobileDesktopGap()", () => {
  it("returns positive gap when mobile < desktop", () => {
    expect(computeMobileDesktopGap(60, 90)).toBe(30);
  });

  it("returns 0 when mobile equals desktop", () => {
    expect(computeMobileDesktopGap(85, 85)).toBe(0);
  });

  it("returns 0 when mobile is better than desktop (edge case)", () => {
    expect(computeMobileDesktopGap(95, 80)).toBe(0);
  });

  it("returns 0 when either score is null", () => {
    expect(computeMobileDesktopGap(null, 90)).toBe(0);
    expect(computeMobileDesktopGap(70, null)).toBe(0);
    expect(computeMobileDesktopGap(null, null)).toBe(0);
  });

  it("threshold check: gap > 15 should flag as issue", () => {
    expect(computeMobileDesktopGap(70, 90)).toBeGreaterThan(15);
    expect(computeMobileDesktopGap(80, 90)).toBeLessThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// computeGeoScore()
// ---------------------------------------------------------------------------

describe("computeGeoScore()", () => {
  it("returns all zero scores for a worst-case site", () => {
    const result = computeGeoScore({
      jsRenderedPct:   1.0,    // 100% JS-rendered
      hasLlmsTxt:      false,
      hasSchemaJsonld: false,
      aiReadabilityScore: 0,
    });
    expect(result.overallGeoScore).toBeLessThan(20);
    expect(result.llmsTxtScore).toBe(0);
    expect(result.jsRenderScore).toBe(0);
  });

  it("returns high scores for an ideal GEO site", () => {
    const result = computeGeoScore({
      jsRenderedPct:   0,       // 0% JS-rendered
      hasLlmsTxt:      true,
      hasSchemaJsonld: true,
      aiReadabilityScore: 95,
    });
    expect(result.llmsTxtScore).toBe(100);
    expect(result.schemaJsonldScore).toBe(100);
    expect(result.jsRenderScore).toBe(100);
    expect(result.overallGeoScore).toBeGreaterThan(80);
  });

  it("jsRenderScore penalises high JS rendering", () => {
    const low  = computeGeoScore({ jsRenderedPct: 0.1 });
    const high = computeGeoScore({ jsRenderedPct: 0.9 });
    expect(low.jsRenderScore).toBeGreaterThan(high.jsRenderScore);
  });

  it("returns 50 jsRenderScore when pct is null", () => {
    const result = computeGeoScore({ jsRenderedPct: null });
    expect(result.jsRenderScore).toBe(50);
  });

  it("overall score is bounded 0-100", () => {
    const r1 = computeGeoScore({ jsRenderedPct: 0, hasLlmsTxt: true, hasSchemaJsonld: true, aiReadabilityScore: 100 });
    const r2 = computeGeoScore({ jsRenderedPct: 1, hasLlmsTxt: false, hasSchemaJsonld: false, aiReadabilityScore: 0 });
    expect(r1.overallGeoScore).toBeLessThanOrEqual(100);
    expect(r2.overallGeoScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// detectColdStart()
// ---------------------------------------------------------------------------

describe("detectColdStart()", () => {
  it("returns cold_start when fewer than 3 owned keywords", () => {
    const signals: ColdStartSignals = {
      ownedKeywordCount: 2,
      bestRanking: 8,
      estimatedTrafficSum: 1000,
    };
    expect(detectColdStart(signals)).toBe("cold_start");
  });

  it("returns cold_start when best ranking is worse than 20", () => {
    const signals: ColdStartSignals = {
      ownedKeywordCount: 10,
      bestRanking: 25,
      estimatedTrafficSum: 100,
    };
    expect(detectColdStart(signals)).toBe("cold_start");
  });

  it("returns cold_start when estimatedTrafficSum is 0", () => {
    const signals: ColdStartSignals = {
      ownedKeywordCount: 5,
      bestRanking: 15,
      estimatedTrafficSum: 0,
    };
    expect(detectColdStart(signals)).toBe("cold_start");
  });

  it("returns emerging for moderate signals", () => {
    const signals: ColdStartSignals = {
      ownedKeywordCount: 8,
      bestRanking: 12,
      estimatedTrafficSum: 500,
    };
    expect(detectColdStart(signals)).toBe("emerging");
  });

  it("returns established for strong signals", () => {
    const signals: ColdStartSignals = {
      ownedKeywordCount: 20,
      bestRanking: 3,
      estimatedTrafficSum: 5000,
    };
    expect(detectColdStart(signals)).toBe("established");
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity()
// ---------------------------------------------------------------------------

describe("jaccardSimilarity()", () => {
  it("returns 1.0 for identical sets", () => {
    const a = new Set(["seo", "tool", "marketing"]);
    expect(jaccardSimilarity(a, a)).toBe(1.0);
  });

  it("returns 0.0 for completely disjoint sets", () => {
    const a = new Set(["foo", "bar"]);
    const b = new Set(["baz", "qux"]);
    expect(jaccardSimilarity(a, b)).toBe(0.0);
  });

  it("returns 0.0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0.0);
  });

  it("returns correct partial similarity", () => {
    const a = new Set(["seo", "tool", "analytics"]);
    const b = new Set(["seo", "tool", "marketing"]);
    // intersection: {seo, tool}, union: {seo, tool, analytics, marketing}
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4, 5);
  });

  it("cannibalization threshold: >=0.7 should flag", () => {
    const a = new Set(["best", "seo"]);
    const b = new Set(["best", "seo", "tool"]);
    const sim = jaccardSimilarity(a, b);
    // {best, seo} / {best, seo, tool} = 2/3 ≈ 0.667 → under threshold
    expect(sim).toBeCloseTo(2 / 3, 5);
  });
});

// ---------------------------------------------------------------------------
// isCacheHit()
// ---------------------------------------------------------------------------

describe("isCacheHit()", () => {
  const HASH_A = "abc123";
  const HASH_B = "def456";
  const NOW = Date.now();
  const DAY_MS = 1000 * 60 * 60 * 24;

  it("returns true for fresh cache with same hash", () => {
    const cachedAt = new Date(NOW - 2 * DAY_MS); // 2 days old
    expect(isCacheHit(cachedAt, HASH_A, HASH_A, NOW)).toBe(true);
  });

  it("returns false when hash changed (content modified)", () => {
    const cachedAt = new Date(NOW - 2 * DAY_MS);
    expect(isCacheHit(cachedAt, HASH_A, HASH_B, NOW)).toBe(false);
  });

  it("returns false when cache is older than 7 days", () => {
    const cachedAt = new Date(NOW - 8 * DAY_MS);
    expect(isCacheHit(cachedAt, HASH_A, HASH_A, NOW)).toBe(false);
  });

  it("returns true for exactly 7 days (at boundary)", () => {
    const cachedAt = new Date(NOW - 7 * DAY_MS + 1000); // just under 7 days
    expect(isCacheHit(cachedAt, HASH_A, HASH_A, NOW)).toBe(true);
  });

  it("returns false when cache is older than 30 days regardless of hash", () => {
    const cachedAt = new Date(NOW - 31 * DAY_MS);
    expect(isCacheHit(cachedAt, HASH_A, HASH_A, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeScanContentHash()
// ---------------------------------------------------------------------------

describe("computeScanContentHash()", () => {
  it("returns a 64-char hex string", () => {
    const hash = computeScanContentHash({
      title: "Test", metaDescription: "Desc", h1: "H1", wordCount: 100,
    });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns different hash when title changes", () => {
    const a = computeScanContentHash({ title: "A", metaDescription: "X", h1: "Y", wordCount: 100 });
    const b = computeScanContentHash({ title: "B", metaDescription: "X", h1: "Y", wordCount: 100 });
    expect(a).not.toBe(b);
  });

  it("returns same hash for identical inputs", () => {
    const scan = { title: "Same", metaDescription: "Desc", h1: "H1", wordCount: 200 };
    expect(computeScanContentHash(scan)).toBe(computeScanContentHash(scan));
  });

  it("handles null values without throwing", () => {
    expect(() =>
      computeScanContentHash({ title: null, metaDescription: null, h1: null, wordCount: null }),
    ).not.toThrow();
  });

  it("returns different hash when word count changes", () => {
    const a = computeScanContentHash({ title: "T", metaDescription: "D", h1: "H", wordCount: 100 });
    const b = computeScanContentHash({ title: "T", metaDescription: "D", h1: "H", wordCount: 500 });
    expect(a).not.toBe(b);
  });
});
