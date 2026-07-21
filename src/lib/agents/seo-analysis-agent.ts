/**
 * SEO Analysis Agent (spec §3.6)
 *
 * Step 1 — Detect issues from WebsiteScan + Keyword facts: pure math, no LLM.
 * Step 2 — Score each issue with SEO_WEIGHTS (impact/effort table).
 * Step 3 — Generate recommendation text via runAgent() with SEORecommendation schema.
 * Step 4 — Write Recommendation fact with evidence_fact_ids.
 * Step 5 — On ANY error: writeAgentFailure, return null.
 */

import { eq, desc, and, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans, keywords, recommendations } from "@/lib/db/schema";

import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { writeRecommendation, calculateImpact } from "@/lib/scoring/recommendation-engine";
import { generateSeoRecommendation } from "@/lib/agents/seo-recommendation-agent";
import { fetchSeoScoreAudit } from "@/lib/integrations/seo-score-api";
import type { RecommendationRow } from "@/lib/scoring/recommendation-engine";

// ---------------------------------------------------------------------------
// SEO_WEIGHTS — pure scoring table, no LLM (spec §3.6)
// ---------------------------------------------------------------------------

type SeoIssueType =
  | "missing_meta_description"
  | "broken_h1"
  | "keyword_gap_high_volume"
  | "slow_lcp"
  | "missing_sitemap"
  | "no_schema_markup"
  | "missing_open_graph"
  | "missing_llms_txt"
  | "missing_dmarc_spf"
  | "low_overall_seo_score"
  | "api_audit_priority";

const SEO_WEIGHTS: Record<SeoIssueType, { impact: number; effort: number }> = {
  missing_meta_description: { impact: 0.6, effort: 0.1 },
  broken_h1:                { impact: 0.7, effort: 0.1 },
  keyword_gap_high_volume:  { impact: 0.9, effort: 0.7 },
  slow_lcp:                 { impact: 0.8, effort: 0.6 },
  missing_sitemap:          { impact: 0.5, effort: 0.05 },
  no_schema_markup:         { impact: 0.4, effort: 0.3 },
  missing_open_graph:       { impact: 0.65, effort: 0.15 },
  missing_llms_txt:         { impact: 0.85, effort: 0.1 },
  missing_dmarc_spf:        { impact: 0.55, effort: 0.2 },
  low_overall_seo_score:    { impact: 0.9, effort: 0.5 },
  api_audit_priority:       { impact: 0.95, effort: 0.4 },
};

function scoreSeoIssue(
  issueType: SeoIssueType,
  volume?: number,
): { impact: number; effort: number; priorityScore: number } {
  const base = SEO_WEIGHTS[issueType] ?? { impact: 0.7, effort: 0.3 };
  let impact = base.impact;
  // Volume-adjusted impact for keyword gaps
  if (issueType === "keyword_gap_high_volume" && volume != null) {
    impact = Math.min(impact * Math.min(volume / 10_000, 2.0), 1.0);
  }
  return {
    impact,
    effort:        base.effort,
    priorityScore: impact / (base.effort + 0.01),
  };
}

// ---------------------------------------------------------------------------
// SEORecommendation agent contract (spec §3.6)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Issue detection — pure logic from scan + seoscoreapi.com + keyword facts
// ---------------------------------------------------------------------------

interface DetectedIssue {
  type:          SeoIssueType;
  evidenceFactId: string;          // WebsiteScan.id or Keyword.id
  volume?:       number;
  context:       Record<string, unknown>; // passed to runAgent
}

async function detectIssues(
  startupId: string,
  scan: typeof websiteScans.$inferSelect,
): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  // Fetch live audit from seoscoreapi.com (uses full API capacity)
  const auditResult = await fetchSeoScoreAudit(scan.url);
  const auditContext = auditResult ? {
    overallScore: auditResult.score,
    grade: auditResult.grade,
    responseTime: auditResult.responseTime,
  } : {};

  // 1. Overall Audit Score & Grade Check (from seoscoreapi.com)
  if (auditResult && (auditResult.score < 80 || auditResult.grade === "C" || auditResult.grade === "D" || auditResult.grade === "F")) {
    issues.push({
      type: "low_overall_seo_score",
      evidenceFactId: scan.id,
      context: {
        issue: `Overall SEO Score is ${auditResult.score}/100 (Grade: ${auditResult.grade}). Needs comprehensive optimization across On-Page, GEO, and Technical performance.`,
        score: auditResult.score,
        grade: auditResult.grade,
        url: scan.url,
        ...auditContext,
      },
    });
  }

  // 2. Generative Engine Optimization (GEO) / LLM Readability Check
  const llmReadability = auditResult?.aiReadability as Record<string, unknown> | undefined;
  if (auditResult && (!llmReadability || llmReadability.has_llms_txt === false || llmReadability.llms_txt === false)) {
    issues.push({
      type: "missing_llms_txt",
      evidenceFactId: scan.id,
      context: {
        issue: "Missing llms.txt file — Generative Engine Optimization (GEO) gap. AI search engines (Perplexity, ChatGPT, Claude) require an llms.txt file to accurately index and cite your brand.",
        url: scan.url,
        category: "Generative Engine Optimization (GEO)",
        ...auditContext,
      },
    });
  }

  // 3. Social & Open Graph Metadata Check
  const socialChecks = auditResult?.audit?.social?.checks;
  const ogCheck = socialChecks?.find(c => c.name === "open_graph" || c.name === "og_tags");
  if (ogCheck && ogCheck.status !== "pass") {
    issues.push({
      type: "missing_open_graph",
      evidenceFactId: scan.id,
      context: {
        issue: "Open Graph social metadata missing or incomplete. Social media shares on LinkedIn, Facebook, and Twitter will lack rich titles and image previews.",
        url: scan.url,
        ...auditContext,
      },
    });
  }

  // 4. On-Page Basics
  if (!scan.metaDescription) {
    issues.push({
      type:          "missing_meta_description",
      evidenceFactId: scan.id,
      context: {
        issue:   "No meta description found",
        url:     scan.url,
        title:   scan.title,
        h1:      scan.h1,
        ...auditContext,
      },
    });
  }

  if (!scan.h1) {
    issues.push({
      type:          "broken_h1",
      evidenceFactId: scan.id,
      context: {
        issue: "No H1 tag found on the page",
        url:   scan.url,
        title: scan.title,
        ...auditContext,
      },
    });
  }

  if (scan.lcpMs != null && scan.lcpMs > 4000) {
    issues.push({
      type:          "slow_lcp",
      evidenceFactId: scan.id,
      context: {
        issue:   `LCP is ${scan.lcpMs}ms — above the 4s failure threshold`,
        lcpMs:   scan.lcpMs,
        url:     scan.url,
        techStack: scan.techStack,
        ...auditContext,
      },
    });
  }

  if (!scan.hasSitemap) {
    issues.push({
      type:          "missing_sitemap",
      evidenceFactId: scan.id,
      context: { issue: "No sitemap.xml detected", url: scan.url, ...auditContext },
    });
  }

  // 5. Incorporate High-Priority Audit Findings directly from seoscoreapi.com
  if (auditResult?.priorities && Array.isArray(auditResult.priorities)) {
    for (const prio of auditResult.priorities.slice(0, 2)) {
      if (prio.title || prio.description) {
        issues.push({
          type: "api_audit_priority",
          evidenceFactId: scan.id,
          context: {
            issue: prio.title || "SEO Audit High Priority Item",
            description: prio.description,
            impact: prio.impact || "high",
            url: scan.url,
            ...auditContext,
          },
        });
      }
    }
  }

  // 6. Keyword gaps with high volume
  const highVolumeGaps = await db
    .select()
    .from(keywords)
    .where(
      and(
        eq(keywords.startupId, startupId),
        eq(keywords.type, "gap"),
        gt(keywords.searchVolume, 500),
      ),
    )
    .orderBy(desc(keywords.searchVolume))
    .limit(3);

  for (const kw of highVolumeGaps) {
    issues.push({
      type:           "keyword_gap_high_volume",
      evidenceFactId: kw.id,
      volume:         kw.searchVolume ?? undefined,
      context: {
        issue:         `Keyword gap: "${kw.term}" (${kw.searchVolume?.toLocaleString()} searches/month)`,
        term:          kw.term,
        searchVolume:  kw.searchVolume,
        startupRanking: kw.startupRanking,
        ...auditContext,
      },
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// RecommendationRow is re-exported from recommendation-engine — use that type directly.

export async function runSeoAnalysis(startupId: string): Promise<RecommendationRow[] | null> {
  try {
    // Need a recent scan
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

    const todayKey  = buildIdempotencyKey("SeoAnalysis", startupId, "scan", todayWindow());
    const issues    = await detectIssues(startupId, scan);
    const written: RecommendationRow[] = [];

    for (const issue of issues) {
      const iKey = `${todayKey}:${issue.type}`;

      // Idempotency — skip if already generated this recommendation today
      const [existing] = await db
        .select({ id: recommendations.id })
        .from(recommendations)
        .where(eq(recommendations.idempotencyKey, iKey))
        .limit(1);
      if (existing) continue;

      const scores = scoreSeoIssue(issue.type, issue.volume);

      // generateSeoRecommendation — the ONLY LLM call in this file
      let rec: Awaited<ReturnType<typeof generateSeoRecommendation>>;
      try {
        rec = await generateSeoRecommendation({
          issueType:            issue.type,
          availableEvidenceIds: [issue.evidenceFactId],
          ...issue.context,
        });
      } catch (agentErr) {
        await writeAgentFailure(startupId, "seo_recommendation_agent", agentErr, issue.context);
        continue;
      }

      // Use spec impact formula — keyword volume boosts impact for keyword_gap issues
      const impactScore = calculateImpact({
        category:      issue.type.startsWith("keyword") ? "content" : "seo",
        keywordVolume: issue.volume,
      });
      const effortScore = SEO_WEIGHTS[issue.type]?.effort ?? 0.3;

      // writeRecommendation enforces evidence_fact_ids not-empty at runtime (spec §4)
      const written_rec = await writeRecommendation({
        startupId,
        idempotencyKey:  iKey,
        category:        issue.type.startsWith("keyword") ? "content" : "seo",
        title:           rec.title,
        description:     rec.description,
        evidenceFactIds: [rec.evidenceFactId],   // model picked from availableEvidenceIds
        targetMetric:    issue.type === "slow_lcp" ? "sessions" : "conversions",
        impactScore,
        confidenceScore: 0.5 + 0.05,            // scraped source base
        effortScore,
        priorityScore:   impactScore / (effortScore + 0.01),
        trustLevelRequired: 1,
      });

      written.push(written_rec);
    }

    return written;
  } catch (err) {
    await writeAgentFailure(startupId, "seo_analysis_agent", err);
    return null;
  }
}
