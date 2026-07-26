/**
 * SEO Analysis Agent — issue detection + GEO scoring + dynamic scoring + LLM batching.
 *
 * Pipeline (spec §3.6):
 *   Step 1  — Load latest WebsiteScan + cached SEO audit (rate-limit-aware).
 *   Step 2  — Detect issues: 16 issue types, all pure math, zero LLM.
 *   Step 3  — Conditional suppression: skip local-SEO checks for SaaS/digital.
 *   Step 4  — Cold-start suppression: skip volume-based gap recs for cold_start sites.
 *   Step 5  — Group issues by page (same root cause = one LLM call, not N).
 *   Step 6  — Dynamic scoring: computeSeoImpact / computeSeoConfidence per group.
 *   Step 7  — Feedback re-ranking: apply per-startup ignore multiplier.
 *   Step 8  — Generate one LLM recommendation per group via generateSeoRecommendation().
 *   Step 9  — Write Recommendation facts with evidenceFactIds.
 *   Step 10 — Compute and write GEO score (separate from health score).
 *
 * No LLM calls before Step 8. Every recommendation carries evidenceFactIds.
 * Idempotency: daily for scan-based issues, weekly for keyword/competitive issues.
 */

import { eq, desc, and, lt, gt, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  websiteScans,
  keywords,
  competitors,
  recommendations,
  feedbackSignals,
  geoScores,
  startups,
} from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, todayWindow, isoWeekWindow } from "@/lib/idempotency";
import { writeRecommendation } from "@/lib/scoring/recommendation-engine";
import { generateSeoRecommendation } from "@/lib/agents/seo-recommendation-agent";
import { getOrFetchSeoAudit } from "@/lib/integrations/seo-score-api";
import { logEvent } from "@/lib/telemetry";
import { generateULID } from "@/lib/ulid";
import type { RecommendationRow } from "@/lib/scoring/recommendation-engine";

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export type SeoIssueType =
  // Existing
  | "low_overall_seo_score"
  | "missing_llms_txt"
  | "missing_open_graph"
  | "missing_meta_description"
  | "broken_h1"
  | "slow_lcp"
  | "missing_sitemap"
  | "api_audit_priority"
  | "keyword_gap_high_volume"
  // New — on-page
  | "title_length_suboptimal"
  | "image_alt_coverage_low"
  | "https_redirect_missing"
  | "analytics_not_detected"
  | "orphan_page_risk"
  | "thin_content"
  | "page_weight_excessive"
  | "mobile_desktop_perf_gap"
  // New — competitive + decay
  | "keyword_cannibalization"
  | "content_decay"
  | "competitive_gap_high_overlap"
  // New — GEO
  | "rendered_content_llm_readability"
  // New checks matching the white-label PDF audit
  | "dmarc_record_missing"
  | "spf_record_missing"
  | "social_pixel_missing"
  | "social_card_missing"
  | "local_seo_schema_missing"
  | "local_seo_gbp_missing"
  | "local_seo_contact_missing"
  | "inline_styles_present"
  | "deprecated_html_tags"
  | "minification_missing"
  | "compression_disabled";

// ---------------------------------------------------------------------------
// LOCAL_SEO_INDUSTRIES — conditional suppression gate
// ---------------------------------------------------------------------------

const LOCAL_SEO_INDUSTRIES = new Set([
  "restaurant",
  "retail",
  "salon",
  "clinic",
  "dental",
  "medical",
  "gym",
  "hotel",
  "real_estate",
  "legal",
  "accounting",
  "plumbing",
  "local_services",
]);

const LOCAL_SEO_ISSUE_TYPES: Set<SeoIssueType> = new Set([
  "local_seo_schema_missing",
  "local_seo_gbp_missing",
  "local_seo_contact_missing",
]);

function isLocalBusiness(industry: string | null | undefined): boolean {
  if (!industry) return false;
  return LOCAL_SEO_INDUSTRIES.has(industry.toLowerCase());
}

// ---------------------------------------------------------------------------
// Static effort estimates (per issue type)
// ---------------------------------------------------------------------------

const STATIC_EFFORT: Record<SeoIssueType, number> = {
  missing_meta_description:      0.10,
  broken_h1:                     0.08,
  missing_sitemap:               0.05,
  missing_llms_txt:              0.10,
  https_redirect_missing:        0.15,
  analytics_not_detected:        0.20,
  title_length_suboptimal:       0.08,
  missing_open_graph:            0.15,
  image_alt_coverage_low:        0.30,
  slow_lcp:                      0.60,
  page_weight_excessive:         0.55,
  mobile_desktop_perf_gap:       0.50,
  thin_content:                  0.65,
  orphan_page_risk:              0.25,
  keyword_gap_high_volume:       0.70,
  competitive_gap_high_overlap:  0.70,
  keyword_cannibalization:       0.45,
  content_decay:                 0.50,
  rendered_content_llm_readability: 0.70,
  low_overall_seo_score:         0.50,
  api_audit_priority:            0.40,
  // New checks
  dmarc_record_missing:          0.15,
  spf_record_missing:            0.15,
  social_pixel_missing:          0.20,
  social_card_missing:           0.15,
  local_seo_schema_missing:      0.25,
  local_seo_gbp_missing:         0.30,
  local_seo_contact_missing:     0.10,
  inline_styles_present:         0.35,
  deprecated_html_tags:          0.20,
  minification_missing:          0.15,
  compression_disabled:          0.15,
};

// ---------------------------------------------------------------------------
// PURE MATH SCORING FUNCTIONS — exported for unit tests
// ---------------------------------------------------------------------------

/** Normalise a value to [0, 1] using min-max scaling. */
export function normalise(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * computeSeoImpact — replaces hardcoded SEO_WEIGHTS.
 *
 * impact = normalize(volume) * 0.4
 *        + normalize(competitorCount) * 0.3
 *        + technical_severity * 0.3
 *
 * For cold_start startups: cap keyword-gap/competitive-gap impact at 0.4,
 * boost foundational issue impact by 1.2x.
 */
export function computeSeoImpact(opts: {
  issueType:        SeoIssueType;
  searchVolume?:    number;
  competitorCount?: number;
  technicalSeverity?: number; // 0-1; from audit score or issue-type defaults
  isColdStart?:     boolean;
}): number {
  const {
    issueType,
    searchVolume     = 0,
    competitorCount  = 0,
    technicalSeverity = defaultTechnicalSeverity(issueType),
    isColdStart      = false,
  } = opts;

  const volumeComponent    = normalise(searchVolume, 0, 50_000) * 0.4;
  const competitorComponent = normalise(competitorCount, 0, 5) * 0.3;
  const techComponent       = Math.max(0, Math.min(1, technicalSeverity)) * 0.3;

  let impact = volumeComponent + competitorComponent + techComponent;

  if (isColdStart) {
    const KEYWORD_GAP_TYPES: SeoIssueType[] = [
      "keyword_gap_high_volume",
      "competitive_gap_high_overlap",
    ];
    const FOUNDATIONAL_TYPES: SeoIssueType[] = [
      "analytics_not_detected",
      "missing_sitemap",
      "missing_meta_description",
      "broken_h1",
      "title_length_suboptimal",
      "thin_content",
    ];

    if (KEYWORD_GAP_TYPES.includes(issueType)) {
      impact = Math.min(impact, 0.4); // cap for sites with no authority
    } else if (FOUNDATIONAL_TYPES.includes(issueType)) {
      impact = Math.min(impact * 1.2, 1.0); // boost fundamentals
    }
  }

  return Math.max(0, Math.min(1, impact));
}

function defaultTechnicalSeverity(issueType: SeoIssueType): number {
  // Default severity weight per issue type (used when no live audit data)
  const severityMap: Partial<Record<SeoIssueType, number>> = {
    slow_lcp:                      0.8,
    page_weight_excessive:         0.6,
    mobile_desktop_perf_gap:       0.6,
    https_redirect_missing:        0.7,
    rendered_content_llm_readability: 0.7,
    thin_content:                  0.5,
    missing_llms_txt:              0.75,
    low_overall_seo_score:         0.9,
    api_audit_priority:            0.85,
    keyword_cannibalization:       0.6,
    content_decay:                 0.55,
    analytics_not_detected:        0.65,
    image_alt_coverage_low:        0.4,
    orphan_page_risk:              0.45,
    missing_open_graph:            0.5,
    title_length_suboptimal:       0.45,
    missing_sitemap:               0.4,
    missing_meta_description:      0.55,
    broken_h1:                     0.6,
    keyword_gap_high_volume:       0.5,
    competitive_gap_high_overlap:  0.7,
    // New checks
    dmarc_record_missing:          0.6,
    spf_record_missing:            0.6,
    social_pixel_missing:          0.4,
    social_card_missing:           0.4,
    local_seo_schema_missing:      0.5,
    local_seo_gbp_missing:         0.6,
    local_seo_contact_missing:     0.5,
    inline_styles_present:         0.4,
    deprecated_html_tags:          0.3,
    minification_missing:          0.3,
    compression_disabled:          0.5,
  };
  return severityMap[issueType] ?? 0.5;
}

/**
 * computeSeoConfidence — replaces hardcoded 0.55 in v1.
 *
 * 1.0  → GSC + live (non-cached-stale) SEOScoreAPI audit
 * 0.7  → GSC alone OR SEOScoreAPI alone
 * 0.5  → SerpAPI rank OR competitor/brand-voice inference only
 */
export function computeSeoConfidence(opts: {
  hasGsc:            boolean;
  hasLiveAudit:      boolean; // true if audit was fetched fresh (not from cache)
  keywordConfidence?: "gsc" | "serpapi_rank" | "competitor_inferred" | null;
  feedbackBoost?:    number; // 0-0.2 from feedback history
}): number {
  const { hasGsc, hasLiveAudit, keywordConfidence, feedbackBoost = 0 } = opts;

  let base: number;
  if (hasGsc && hasLiveAudit) {
    base = 1.0;
  } else if (hasGsc || hasLiveAudit) {
    base = 0.7;
  } else if (keywordConfidence === "serpapi_rank") {
    base = 0.5;
  } else if (keywordConfidence === "competitor_inferred") {
    base = 0.5;
  } else {
    base = 0.4; // no data source at all
  }

  return Math.max(0, Math.min(1, base + feedbackBoost));
}

/**
 * computeMobileDesktopGap — flags if mobile score is meaningfully worse than desktop.
 * Returns the gap magnitude (0 = no gap, positive = mobile worse than desktop).
 */
export function computeMobileDesktopGap(
  mobileScore: number | null | undefined,
  desktopScore: number | null | undefined,
): number {
  if (mobileScore == null || desktopScore == null) return 0;
  return Math.max(0, desktopScore - mobileScore); // positive = mobile is worse
}

/**
 * computeGeoScore — GEO (Generative Engine Optimization) score 0-100.
 * Inputs:
 *   jsRenderedPct   — fraction of content only visible post-JS (lower = better)
 *   hasLlmsTxt      — whether llms.txt is present
 *   hasSchemaJsonld — whether JSON-LD structured data is present
 *   aiReadabilityScore — 0-100 from SEOScoreAPI (if available; else 50)
 */
export function computeGeoScore(opts: {
  jsRenderedPct?:     number | null;
  hasLlmsTxt?:        boolean | null;
  hasSchemaJsonld?:   boolean | null;
  aiReadabilityScore?: number;
}): {
  overallGeoScore:    number;
  llmsTxtScore:       number;
  schemaJsonldScore:  number;
  jsRenderScore:      number;
  aiReadabilityScore: number;
} {
  const {
    jsRenderedPct     = null,
    hasLlmsTxt        = false,
    hasSchemaJsonld   = false,
    aiReadabilityScore = 50,
  } = opts;

  const llmsTxtScore      = hasLlmsTxt    ? 100 : 0;
  const schemaJsonldScore = hasSchemaJsonld ? 100 : 20; // partial credit if absent (may be implicit)
  const jsRenderScore     = jsRenderedPct != null ? Math.round((1 - jsRenderedPct) * 100) : 50;

  const overallGeoScore = Math.round(
    llmsTxtScore * 0.35 +
    schemaJsonldScore * 0.25 +
    jsRenderScore * 0.25 +
    Math.max(0, Math.min(100, aiReadabilityScore)) * 0.15,
  );

  return { overallGeoScore, llmsTxtScore, schemaJsonldScore, jsRenderScore, aiReadabilityScore };
}

// ---------------------------------------------------------------------------
// Issue descriptor (internal type)
// ---------------------------------------------------------------------------

interface DetectedIssue {
  type:              SeoIssueType;
  evidenceFactIds:   string[];
  pageUrl?:          string;      // for page-level grouping
  volume?:           number;
  competitorCount?:  number;
  keywordConfidence?: "gsc" | "serpapi_rank" | "competitor_inferred";
  context:           Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ISSUE DETECTORS — all pure logic, no LLM
// ---------------------------------------------------------------------------

async function detectIssues(
  startupId:   string,
  scan:        typeof websiteScans.$inferSelect,
  auditResult: ReturnType<typeof getOrFetchSeoAudit> extends Promise<infer T> ? T : never,
  industry:    string | null | undefined,
  isColdStart: boolean,
): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  const audit = auditResult?.result ?? null;
  const fromLiveAudit = auditResult != null && !auditResult.fromCache;

  const auditCtx = audit
    ? { overallScore: audit.score, grade: audit.grade }
    : {};

  // ── EXISTING DETECTORS ─────────────────────────────────────────────────

  // 1. Overall SEO score — guard against null score/grade (BUG-3 fix made them nullable)
  if (audit && audit.score != null && audit.grade != null &&
      (audit.score < 80 || ["C", "D", "F"].includes(audit.grade))) {
    issues.push({
      type: "low_overall_seo_score",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: `Overall SEO Score is ${audit.score}/100 (Grade: ${audit.grade}).`,
        score: audit.score, grade: audit.grade, url: scan.url, ...auditCtx,
      },
    });
  }

  // 2. Missing llms.txt (GEO)
  const llmReadability = audit?.aiReadability as Record<string, unknown> | undefined;
  if (audit && (!llmReadability || llmReadability.has_llms_txt === false || llmReadability.llms_txt === false)) {
    issues.push({
      type: "missing_llms_txt",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: "Missing llms.txt — AI search engines (Perplexity, ChatGPT, Claude) cannot reliably index this site.",
        url: scan.url, category: "GEO", ...auditCtx,
      },
    });
  }

  // 3. Missing Open Graph
  const socialChecks = audit?.audit?.social?.checks;
  const ogCheck = socialChecks?.find((c) => c.name === "open_graph" || c.name === "og_tags");
  if (ogCheck && ogCheck.status !== "pass") {
    issues.push({
      type: "missing_open_graph",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: "Open Graph metadata missing or incomplete. Social media shares will lack rich previews.",
        url: scan.url, ...auditCtx,
      },
    });
  }

  // 4. Missing meta description
  if (!scan.metaDescription) {
    issues.push({
      type: "missing_meta_description",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "No meta description found.", url: scan.url, title: scan.title, h1: scan.h1, ...auditCtx },
    });
  }

  // 5. Missing H1
  if (!scan.h1) {
    issues.push({
      type: "broken_h1",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "No H1 tag found on the page.", url: scan.url, title: scan.title, ...auditCtx },
    });
  }

  // 6. Slow LCP
  if (scan.lcpMs != null && scan.lcpMs > 4000) {
    issues.push({
      type: "slow_lcp",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: `LCP is ${scan.lcpMs}ms — above the 4s failure threshold.`, lcpMs: scan.lcpMs, url: scan.url, ...auditCtx },
    });
  }

  // 7. Missing sitemap
  if (!scan.hasSitemap) {
    issues.push({
      type: "missing_sitemap",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "No sitemap.xml detected.", url: scan.url, ...auditCtx },
    });
  }

  // 8. API audit priorities (top 2)
  if (audit?.priorities && Array.isArray(audit.priorities)) {
    for (const prio of audit.priorities.slice(0, 2)) {
      if (prio.title || prio.description) {
        issues.push({
          type: "api_audit_priority",
          evidenceFactIds: [scan.id],
          pageUrl: scan.url,
          context: {
            issue: prio.title || "SEO Audit High Priority",
            description: prio.description,
            impact: prio.impact || "high",
            url: scan.url,
            ...auditCtx,
          },
        });
      }
    }
  }

  // 9. Keyword gap (high volume) — suppressed for cold_start
  if (!isColdStart) {
    const highVolumeGaps = await db
      .select()
      .from(keywords)
      .where(and(eq(keywords.startupId, startupId), eq(keywords.type, "gap"), gt(keywords.searchVolume, 500)))
      .orderBy(desc(keywords.searchVolume))
      .limit(3);

    for (const kw of highVolumeGaps) {
      issues.push({
        type: "keyword_gap_high_volume",
        evidenceFactIds: [kw.id],
        volume: kw.searchVolume ?? undefined,
        keywordConfidence: kw.confidence as "gsc" | "serpapi_rank" | "competitor_inferred",
        context: {
          issue: `Keyword gap: "${kw.term}" (${(kw.searchVolume ?? 0).toLocaleString()} searches/month, ranking: ${kw.startupRanking ?? "not ranking"})`,
          term: kw.term, searchVolume: kw.searchVolume, startupRanking: kw.startupRanking,
          confidence: kw.confidence, ...auditCtx,
        },
      });
    }
  }

  // ── NEW DETECTORS ──────────────────────────────────────────────────────

  // 10. Title length suboptimal (distinct from missing — checks LENGTH)
  if (scan.title) {
    const titleLen = scan.title.length;
    if (titleLen < 40 || titleLen > 65) {
      const direction = titleLen < 40 ? "too short" : "too long";
      issues.push({
        type: "title_length_suboptimal",
        evidenceFactIds: [scan.id],
        pageUrl: scan.url,
        context: {
          issue: `Title tag is ${direction} (${titleLen} chars). Optimal: 50-60 chars.`,
          currentTitle: scan.title,
          titleLength: titleLen,
          targetRange: "50-60",
          url: scan.url, ...auditCtx,
        },
      });
    }
  }

  // 11. Image alt coverage (RATIO, not boolean)
  if (scan.imageTotal != null && scan.imageTotal > 0 && scan.imageAltMissing != null) {
    const ratio = scan.imageAltMissing / scan.imageTotal;
    if (ratio > 0.3) {
      issues.push({
        type: "image_alt_coverage_low",
        evidenceFactIds: [scan.id],
        pageUrl: scan.url,
        context: {
          issue: `${scan.imageAltMissing} of ${scan.imageTotal} images are missing alt text (${Math.round(ratio * 100)}% uncovered).`,
          imageTotal: scan.imageTotal,
          imageAltMissing: scan.imageAltMissing,
          altCoverageRatio: ratio,
          url: scan.url, ...auditCtx,
        },
      });
    }
  }

  // 12. HTTPS redirect (SSL ≠ redirect — check independently)
  if (scan.hasHttpsRedirect === false) {
    issues.push({
      type: "https_redirect_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: "HTTP is not force-redirected to HTTPS. Users and crawlers can access an unencrypted version.",
        url: scan.url, ...auditCtx,
      },
    });
  }

  // 13. Analytics not detected
  if (scan.analyticsDetected === false) {
    issues.push({
      type: "analytics_not_detected",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: "No analytics tag detected in page HTML (GA, GTM, PostHog, etc.). Cannot measure organic traffic.",
        url: scan.url, techStack: scan.techStack, ...auditCtx,
      },
    });
  }

  // 14. Orphan page risk (requires internalLinks data from scraper)
  if (scan.internalLinks != null && scan.internalLinks.length === 0) {
    issues.push({
      type: "orphan_page_risk",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: "No internal links found pointing to this page from other scanned pages — it may be invisible to crawlers.",
        url: scan.url, ...auditCtx,
      },
    });
  }

  // 15. Page weight excessive (industry-relative vs competitors)
  if (scan.pageWeightKb != null && scan.pageWeightKb > 0) {
    const compRows = await db
      .select()
      .from(competitors)
      .where(eq(competitors.startupId, startupId));

    // Without competitor page weights (not scraped yet), use 3MB as baseline threshold
    const THRESHOLD_KB = 3_000;
    if (scan.pageWeightKb > THRESHOLD_KB) {
      issues.push({
        type: "page_weight_excessive",
        evidenceFactIds: [scan.id],
        pageUrl: scan.url,
        context: {
          issue: `Page weight is ${Math.round(scan.pageWeightKb)}KB — significantly above the 3MB threshold for good performance.`,
          pageWeightKb: scan.pageWeightKb,
          thresholdKb: THRESHOLD_KB,
          url: scan.url, ...auditCtx,
        },
      });
    }
    void compRows; // available for future competitor-relative comparison
  }

  // 16. Mobile/desktop performance gap
  const mobileDesktopGap = computeMobileDesktopGap(scan.mobileScore, scan.desktopPerfScore);
  if (mobileDesktopGap > 15) {
    issues.push({
      type: "mobile_desktop_perf_gap",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: `Mobile performance score (${scan.mobileScore}) is ${Math.round(mobileDesktopGap)} points lower than desktop (${scan.desktopPerfScore}).`,
        mobileScore: scan.mobileScore,
        desktopScore: scan.desktopPerfScore,
        gap: mobileDesktopGap,
        url: scan.url, ...auditCtx,
      },
    });
  }

  // 17. Rendered content LLM readability (GEO category)
  if (scan.jsRenderedPct != null && scan.jsRenderedPct > 0.5) {
    issues.push({
      type: "rendered_content_llm_readability",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: {
        issue: `${Math.round(scan.jsRenderedPct * 100)}% of page content only appears after JavaScript execution — AI crawlers reading raw HTML miss most of the content.`,
        jsRenderedPct: scan.jsRenderedPct,
        url: scan.url, ...auditCtx,
      },
    });
  }

  // 18. Keyword cannibalization (weekly)
  const allOwnedKeywords = await db
    .select()
    .from(keywords)
    .where(and(eq(keywords.startupId, startupId), eq(keywords.type, "owned")));

  // Group by term similarity (simple Jaccard on top-3 query tokens)
  for (let i = 0; i < allOwnedKeywords.length; i++) {
    for (let j = i + 1; j < allOwnedKeywords.length; j++) {
      const a = allOwnedKeywords[i];
      const b = allOwnedKeywords[j];
      if (!a.term || !b.term) continue;

      const tokA = new Set(a.term.toLowerCase().split(/\s+/).slice(0, 3));
      const tokB = new Set(b.term.toLowerCase().split(/\s+/).slice(0, 3));
      const intersection = new Set([...tokA].filter((t) => tokB.has(t)));
      const union = new Set([...tokA, ...tokB]);
      const overlap = union.size === 0 ? 0 : intersection.size / union.size;

      if (overlap >= 0.7) {
        issues.push({
          type: "keyword_cannibalization",
          evidenceFactIds: [a.id, b.id],
          context: {
            issue: `Keywords "${a.term}" and "${b.term}" target near-identical queries (${Math.round(overlap * 100)}% overlap) — consolidate into one page.`,
            term1: a.term, term2: b.term,
            page1Ranking: a.startupRanking, page2Ranking: b.startupRanking,
            overlap, ...auditCtx,
          },
        });
        break; // one cannibalization rec per anchor keyword
      }
    }
  }

  // 19. Content decay (weekly — requires prior_ranking)
  const decayedKeywords = allOwnedKeywords.filter((kw) => {
    if (kw.priorRanking == null || kw.startupRanking == null) return false;
    if (kw.priorRankingWeek == null) return false;
    // Prior week must exist AND ranking must have gotten worse by >5 positions
    return (kw.startupRanking - kw.priorRanking) > 5;
  });

  // Log telemetry for keywords still waiting on second snapshot
  const noBaselineKeywords = allOwnedKeywords.filter(
    (kw) => kw.priorRanking == null && kw.priorRankingWeek == null,
  );
  for (const kw of noBaselineKeywords) {
    await logEvent(startupId, "content_decay_skipped_no_baseline", { term: kw.term, keywordId: kw.id });
  }

  for (const kw of decayedKeywords.slice(0, 3)) {
    issues.push({
      type: "content_decay",
      evidenceFactIds: [kw.id],
      volume: kw.searchVolume ?? undefined,
      keywordConfidence: kw.confidence as "gsc" | "serpapi_rank" | "competitor_inferred",
      context: {
        issue: `"${kw.term}" dropped from position ${kw.priorRanking} to ${kw.startupRanking} (−${(kw.startupRanking ?? 0) - (kw.priorRanking ?? 0)} positions) since last week.`,
        term: kw.term, priorRanking: kw.priorRanking, currentRanking: kw.startupRanking,
        drop: (kw.startupRanking ?? 0) - (kw.priorRanking ?? 0),
        priorWeek: kw.priorRankingWeek, ...auditCtx,
      },
    });
  }

  // 20. Competitive gap high overlap (3+ competitors)
  const highOverlapGaps = await db
    .select()
    .from(keywords)
    .where(
      and(
        eq(keywords.startupId, startupId),
        eq(keywords.type, "competitive_gap"),
        gt(keywords.competitorCount, 2),
      ),
    )
    .orderBy(desc(keywords.competitorCount))
    .limit(3);

  for (const kw of highOverlapGaps) {
    issues.push({
      type: "competitive_gap_high_overlap",
      evidenceFactIds: [kw.id],
      competitorCount: kw.competitorCount,
      context: {
        issue: `"${kw.term}" is used by ${kw.competitorCount} competitors but absent from your content.`,
        term: kw.term, competitorCount: kw.competitorCount, ...auditCtx,
      },
    });
  }

  // 21. Thin content (relative to competitor set average)
  if (scan.wordCount != null && scan.wordCount > 0) {
    const compWords: number[] = [];
    const compRows = await db.select().from(competitors).where(eq(competitors.startupId, startupId));
    for (const comp of compRows) {
      if (comp.heroCopy) {
        compWords.push(comp.heroCopy.trim().split(/\s+/).length);
      }
    }

    if (compWords.length >= 2) {
      const avgCompWords = compWords.reduce((s, v) => s + v, 0) / compWords.length;
      const thinThreshold = avgCompWords * 0.5; // below 50% of competitor avg = thin

      if (scan.wordCount < thinThreshold) {
        issues.push({
          type: "thin_content",
          evidenceFactIds: [scan.id],
          pageUrl: scan.url,
          context: {
            issue: `Page has ${scan.wordCount} words — below 50% of the competitor average (${Math.round(avgCompWords)} words).`,
            wordCount: scan.wordCount, competitorAvgWords: Math.round(avgCompWords),
            thinThreshold: Math.round(thinThreshold), url: scan.url, ...auditCtx,
          },
        });
      }
    }
  }

  // --- ENHANCED DETECTORS ---
  let details: any = {};
  if (scan.detailsJson) {
    try {
      details = JSON.parse(scan.detailsJson);
    } catch { /* ignore */ }
  }

  // SPF / DMARC DNS
  if (details.spfRecord === "") {
    issues.push({
      type: "spf_record_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "SPF DNS record is missing, risking email spoofing and delivery failures.", url: scan.url, ...auditCtx }
    });
  }
  if (details.dmarcRecord === "") {
    issues.push({
      type: "dmarc_record_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "DMARC DNS record is missing, leaving your domain vulnerable to email spoofing.", url: scan.url, ...auditCtx }
    });
  }

  // Social Pixel / Cards
  if (details.hasFbPixel === false) {
    issues.push({
      type: "social_pixel_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "Facebook Pixel is missing. You cannot track conversions or run retargeting campaigns.", url: scan.url, ...auditCtx }
    });
  }
  if (!details.twitterCards || Object.keys(details.twitterCards).length < 2) {
    issues.push({
      type: "social_card_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "Twitter card metadata tags are missing or incomplete. Link shares on X will lack visual cards.", url: scan.url, ...auditCtx }
    });
  }

  // Local SEO
  const localBiz = isLocalBusiness(industry);
  if (localBiz) {
    if (!scan.hasSchemaJsonld) {
      issues.push({
        type: "local_seo_schema_missing",
        evidenceFactIds: [scan.id],
        pageUrl: scan.url,
        context: { issue: "Local Business JSON-LD schema markup is missing for your local startup.", url: scan.url, ...auditCtx }
      });
    }
    const phoneInText = scan.heroCopy && /(\+?\d{1,4}[-.\s]??\d{1,3}[-.\s]??\d{3,4}[-.\s]??\d{3,4})/g.test(scan.heroCopy);
    if (!phoneInText) {
      issues.push({
        type: "local_seo_contact_missing",
        evidenceFactIds: [scan.id],
        pageUrl: scan.url,
        context: { issue: "Phone number or physical address not clearly displayed in your landing page content.", url: scan.url, ...auditCtx }
      });
    }
    issues.push({
      type: "local_seo_gbp_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "Google Business Profile mapping is missing or unverified.", url: scan.url, ...auditCtx }
    });
  }

  // Performance/HTML Styles
  if (details.inlineStylesCount > 15) {
    issues.push({
      type: "inline_styles_present",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: `Exceeded inline styles count: found ${details.inlineStylesCount} style attributes. Move them to external CSS.`, url: scan.url, ...auditCtx }
    });
  }
  if (details.deprecatedTagsCount > 0) {
    issues.push({
      type: "deprecated_html_tags",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: `Found ${details.deprecatedTagsCount} deprecated HTML tags (e.g. <center>, <font>). Replace them with modern CSS.`, url: scan.url, ...auditCtx }
    });
  }
  if (details.isMinified === false) {
    issues.push({
      type: "minification_missing",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "JavaScript or CSS files are unminified, increasing total asset transfer sizes.", url: scan.url, ...auditCtx }
    });
  }
  if (details.isCompressed === false) {
    issues.push({
      type: "compression_disabled",
      evidenceFactIds: [scan.id],
      pageUrl: scan.url,
      context: { issue: "HTTP server compression (Gzip/Brotli) is not active for page assets.", url: scan.url, ...auditCtx }
    });
  }

  // Conditional suppression: remove local-SEO issues for non-local businesses
  return issues.filter((issue) => {
    if (!localBiz && LOCAL_SEO_ISSUE_TYPES.has(issue.type)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// PAGE GROUPING — batch same-page issues into one LLM call
// ---------------------------------------------------------------------------

interface IssueGroup {
  pageUrl?:    string;
  issues:      DetectedIssue[];
  groupKey:    string;
  isWeekly:    boolean;
}

const WEEKLY_ISSUES = new Set<SeoIssueType>([
  "keyword_cannibalization",
  "content_decay",
  "competitive_gap_high_overlap",
  "thin_content",
  "orphan_page_risk",
]);

function groupIssuesByPage(issues: DetectedIssue[]): IssueGroup[] {
  const pageMap = new Map<string, DetectedIssue[]>();

  for (const issue of issues) {
    const key = issue.pageUrl ?? "__global__";
    if (!pageMap.has(key)) pageMap.set(key, []);
    pageMap.get(key)!.push(issue);
  }

  return [...pageMap.entries()].map(([pageUrl, pageIssues]) => ({
    pageUrl:  pageUrl === "__global__" ? undefined : pageUrl,
    issues:   pageIssues,
    groupKey: pageUrl,
    isWeekly: pageIssues.every((i) => WEEKLY_ISSUES.has(i.type)),
  }));
}

// ---------------------------------------------------------------------------
// FEEDBACK RE-RANKING
// ---------------------------------------------------------------------------

async function getFeedbackMultiplier(
  startupId:  string,
  issueTypes: string[],
  currentConfidence: number,
  priorConfidence?:  number,
): Promise<number> {
  // Count recent ignores for these issue types in this startup's SEO category
  const recentSignals = await db
    .select({ action: feedbackSignals.action })
    .from(feedbackSignals)
    .where(and(eq(feedbackSignals.startupId, startupId), eq(feedbackSignals.category, "seo")));

  const ignoreCount  = recentSignals.filter((s) => s.action === "ignored").length;
  const approveCount = recentSignals.filter((s) => s.action === "approved").length;
  const total        = ignoreCount + approveCount;

  if (total === 0) return 1.0;

  const ignoreRate = ignoreCount / total;

  // If confidence just increased (e.g. GSC-confirmed gap that was previously ignored),
  // don't apply the down-weight — resurface it at full weight
  const confidenceIncreased = priorConfidence != null && currentConfidence > priorConfidence + 0.15;
  if (confidenceIncreased) return 1.0;

  // Down-weight proportional to ignore rate
  return Math.max(0.3, 1.0 - ignoreRate * 0.7);
}

// ---------------------------------------------------------------------------
// GEO SCORE WRITER
// ---------------------------------------------------------------------------

async function writeGeoScore(
  startupId:  string,
  scan:       typeof websiteScans.$inferSelect,
  auditResult: Awaited<ReturnType<typeof getOrFetchSeoAudit>>,
): Promise<void> {
  const llmReadability = auditResult?.result?.aiReadability as Record<string, unknown> | undefined;
  const aiReadabilityScore = (llmReadability?.score as number | undefined) ?? 50;

  const geoCalc = computeGeoScore({
    jsRenderedPct:     scan.jsRenderedPct,
    hasLlmsTxt:        llmReadability?.has_llms_txt as boolean | undefined,
    hasSchemaJsonld:   scan.hasSchemaJsonld,
    aiReadabilityScore,
  });

  const iKey = buildIdempotencyKey("GeoScore", startupId, scan.id, todayWindow());
  await db
    .insert(geoScores)
    .values({
      id:                 generateULID(),
      startupId,
      scanId:             scan.id,
      idempotencyKey:     iKey,
      ...geoCalc,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// EFFORT CALIBRATION (blend static with feedback history)
// ---------------------------------------------------------------------------

async function computeEffort(
  startupId: string,
  issueType: SeoIssueType,
): Promise<number> {
  const baseEffort = STATIC_EFFORT[issueType] ?? 0.4;

  // Fetch historical edit_delta_chars for this category
  const historicalSignals = await db
    .select({ editDeltaChars: feedbackSignals.editDeltaChars })
    .from(feedbackSignals)
    .where(
      and(
        eq(feedbackSignals.startupId, startupId),
        eq(feedbackSignals.category, "seo"),
      ),
    );

  const edits = historicalSignals
    .map((s) => s.editDeltaChars)
    .filter((v): v is number => v != null && v > 0);

  if (edits.length < 3) return baseEffort;

  // Median edit delta as a proxy for real effort
  edits.sort((a, b) => a - b);
  const median = edits[Math.floor(edits.length / 2)];
  const normalizedMedian = Math.min(1.0, median / 5000); // 5000 chars = max effort

  // Blend 70% static, 30% historical
  return 0.7 * baseEffort + 0.3 * normalizedMedian;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

export async function runSeoAnalysis(startupId: string): Promise<RecommendationRow[] | null> {
  try {
    const [scan] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.startupId, startupId))
      .orderBy(desc(websiteScans.createdAt))
      .limit(1);

    if (!scan) {
      console.info(`[seo-analysis] No WebsiteScan yet for ${startupId} — skipping.`);
      return null;
    }

    // Load startup context (industry + seo_maturity)
    const [startup] = await db
      .select({ industry: startups.industry, seoMaturity: startups.seoMaturity })
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);

    const isColdStart = startup?.seoMaturity === "cold_start";
    const hasGsc = !!(await db
      .select({ id: startups.id })
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1));

    // Rate-limit-aware audit fetch
    const auditResult = await getOrFetchSeoAudit(startupId, scan);
    const hasLiveAudit = auditResult != null && !auditResult.fromCache;

    // Write GEO score in parallel with issue detection
    const [issuesResult] = await Promise.allSettled([
      detectIssues(startupId, scan, auditResult, startup?.industry, isColdStart),
      writeGeoScore(startupId, scan, auditResult),
    ]);

    if (issuesResult.status === "rejected") {
      await writeAgentFailure(startupId, "seo_analysis_issue_detection", issuesResult.reason);
      return null;
    }

    const issues  = issuesResult.value;
    const groups  = groupIssuesByPage(issues);
    const written: RecommendationRow[] = [];

    for (const group of groups) {
      // Build idempotency key incorporating all issue types + page + time window
      const timeWindow = group.isWeekly ? isoWeekWindow() : todayWindow();
      const issueTypeKey = group.issues.map((i) => i.type).sort().join("+");
      const pageKey = group.pageUrl
        ? Buffer.from(group.pageUrl).toString("base64").slice(0, 16)
        : "global";
      const iKey = buildIdempotencyKey("SeoAnalysis", startupId, `${pageKey}:${issueTypeKey}`, timeWindow);

      // Idempotency check
      const [existing] = await db
        .select({ id: recommendations.id })
        .from(recommendations)
        .where(eq(recommendations.idempotencyKey, iKey))
        .limit(1);
      if (existing) continue;

      // Collect all evidence IDs across the group
      const allEvidenceIds = [...new Set(group.issues.flatMap((i) => i.evidenceFactIds))];

      // Aggregate signals for scoring
      const maxVolume = Math.max(...group.issues.map((i) => i.volume ?? 0));
      const maxCompCount = Math.max(...group.issues.map((i) => i.competitorCount ?? 0));
      const primaryIssueType = group.issues[0].type;
      const kwConfidence = group.issues[0].keywordConfidence;

      // Technical severity from audit score (if available, normalised to 0-1)
      const auditSeverity = auditResult?.result?.score != null
        ? (100 - auditResult.result.score) / 100
        : defaultTechnicalSeverity(primaryIssueType);

      const impact = computeSeoImpact({
        issueType: primaryIssueType,
        searchVolume: maxVolume,
        competitorCount: maxCompCount,
        technicalSeverity: auditSeverity,
        isColdStart,
      });

      const confidence = computeSeoConfidence({
        hasGsc: !!hasGsc,
        hasLiveAudit,
        keywordConfidence: kwConfidence,
      });

      const effort = await computeEffort(startupId, primaryIssueType);

      // Feedback re-ranking
      const feedbackMultiplier = await getFeedbackMultiplier(
        startupId,
        group.issues.map((i) => i.type),
        confidence,
      );

      const rawPriority  = impact * confidence / (effort + 0.01);
      const priorityScore = rawPriority * feedbackMultiplier;

      // Build merged LLM context for all issues in this group
      const mergedContext = {
        issueTypes:           group.issues.map((i) => i.type),
        availableEvidenceIds: allEvidenceIds,
        startupId,
        pageUrl:              group.pageUrl,
        isColdStart,
        seoMaturity:          startup?.seoMaturity,
        industry:             startup?.industry,
        issues:               group.issues.map((i) => i.context),
      };

      // Single LLM call per group (not per issue)
      let rec: Awaited<ReturnType<typeof generateSeoRecommendation>>;
      try {
        rec = await generateSeoRecommendation(mergedContext);
      } catch (agentErr) {
        await writeAgentFailure(startupId, "seo_recommendation_agent", agentErr, mergedContext);
        continue;
      }

      const category = ["keyword_gap_high_volume", "keyword_cannibalization", "content_decay",
        "competitive_gap_high_overlap", "thin_content"].includes(primaryIssueType)
        ? "content" : "seo";

      const writtenRec = await writeRecommendation({
        startupId,
        idempotencyKey:     iKey,
        category,
        title:              rec.title,
        description:        rec.description,
        evidenceFactIds:    rec.evidenceFactIds.filter((id) => allEvidenceIds.includes(id)),
        targetMetric:       rec.expectedImpactMetric,
        impactScore:        impact,
        confidenceScore:    confidence,
        effortScore:        effort,
        priorityScore,
        trustLevelRequired: 1,
      });

      written.push(writtenRec);
    }

    return written;
  } catch (err) {
    await writeAgentFailure(startupId, "seo_analysis_agent", err);
    return null;
  }
}
