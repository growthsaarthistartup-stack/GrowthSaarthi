/**
 * SEO Recommendation Agent — LLM call contract for the SEO analysis pipeline.
 *
 * CRITICAL RULES (spec §4):
 *   - evidenceFactIds is PLURAL — every recommendation must cite ≥1 real fact rows.
 *   - The model must NEVER invent a keyword, number, or URL not in the provided context.
 *   - run_agent() verifies the first evidenceFactId exists in the DB.
 *   - For batched (same-page) calls: one recommendation per page group, merging
 *     all issues sharing the same root cause.
 *
 * No scoring logic lives here — all math is in seo-analysis-agent.ts.
 */

import { z } from "zod";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans, keywords, competitors } from "@/lib/db/schema";
import { runAgent, type AgentContract, type FactExistsCheck } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";

// ---------------------------------------------------------------------------
// Output schema — v2 (evidenceFactIds is PLURAL, adds expectedImpactMetric etc.)
// ---------------------------------------------------------------------------

export const SEORecommendationSchema = z.object({
  title: z.string().max(120),

  description: z.string().min(50),
  // Must be maximally specific:
  // - State exact current value AND exact target (e.g. "shorten title from 64 chars to 50-60; current: '<title text>'")
  // - For competitive_gap: name which competitors justify this recommendation
  // - Do NOT repeat the issue verbatim — add actionable next-steps

  evidenceFactIds: z.array(z.string().min(1)).min(1),
  // Must echo back IDs from the availableEvidenceIds list in context.
  // Never invent an ID. The first ID is validated against the DB by run_agent().

  expectedImpactMetric: z.enum([
    "organic_sessions",
    "keyword_ranking",
    "conversions",
    "engagement",
    "ai_crawler_visibility",
    "page_speed",
  ]),

  expectedTimeframeDays: z.union([
    z.literal(7),
    z.literal(14),
    z.literal(30),
    z.literal(90),
  ]),

  cannibalizationTargets: z.array(z.string()).optional(),
  // URLs to consolidate — ONLY for keyword_cannibalization issue type.
  // Omit for all other issue types.
});

export type SEORecommendation = z.infer<typeof SEORecommendationSchema>;

// ---------------------------------------------------------------------------
// Agent contract
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior SEO and growth consultant writing actionable recommendations for a startup founder.

STRICT RULES — violating any of these causes the output to be rejected:
1. NEVER invent a keyword, ranking number, URL, or competitor name not present in the evidence_facts provided in context.
2. Be MAXIMALLY SPECIFIC in description: always state the exact current value and exact target.
   Example: "Your title tag is 78 characters — shorten it to 50-60. Current title: '${"{"}title{"}"}'."
   NOT: "Improve your title tag length."
3. When multiple issues share the same root cause on the same page, produce ONE recommendation that addresses all of them together. Do not produce separate recommendations for "fix meta" and "fix H1" if they're the same page-optimization task.
4. For any competitive_gap recommendation, explicitly name which competitor(s) use this term. E.g. "Competitors Intercom and Drift both target 'customer success software'..."
5. evidenceFactIds must be selected from the availableEvidenceIds list in context. Echo them back exactly — do not truncate or invent new ones.
6. Output valid JSON only. No markdown fences, no prose before or after.`;

export const SEO_RECOMMENDATION_AGENT: AgentContract<typeof SEORecommendationSchema> = {
  name:          "seo_recommendation_agent",
  model:         MODEL_ROUTES.seo_recommendation[0],
  fallbackModel: MODEL_ROUTES.seo_recommendation[1],
  systemPrompt:  SYSTEM_PROMPT,
  outputSchema:  SEORecommendationSchema,
  maxRetries:    2,
};

// ---------------------------------------------------------------------------
// factExists hook — verifies first evidenceFactId resolves to a real DB row
// ---------------------------------------------------------------------------

const seoFactExists: FactExistsCheck = async (factId: string): Promise<boolean> => {
  const [scan] = await db
    .select({ id: websiteScans.id })
    .from(websiteScans)
    .where(eq(websiteScans.id, factId))
    .limit(1);
  if (scan) return true;

  const [kw] = await db
    .select({ id: keywords.id })
    .from(keywords)
    .where(eq(keywords.id, factId))
    .limit(1);
  if (kw) return true;

  const [comp] = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(eq(competitors.id, factId))
    .limit(1);
  return !!comp;
};

// ---------------------------------------------------------------------------
// Main export — called by seo-analysis-agent.ts for each page issue group
// ---------------------------------------------------------------------------

export interface SeoIssueGroupContext {
  /** All issue types being merged into this single recommendation */
  issueTypes:          string[];
  /** All DB row IDs the model may select from for evidenceFactIds */
  availableEvidenceIds: string[];
  /** Startup + page context passed to the model */
  [key: string]: unknown;
}

export async function generateSeoRecommendation(
  ctx: SeoIssueGroupContext,
): Promise<SEORecommendation> {
  // run_agent verifies the FIRST evidenceFactId against seoFactExists
  return runAgent(SEO_RECOMMENDATION_AGENT, ctx, seoFactExists);
}
