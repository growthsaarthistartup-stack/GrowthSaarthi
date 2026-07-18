/**
 * SEO Recommendation Agent — the ONE LLM call in the SEO scoring pipeline (spec §3.6).
 *
 * The output schema requires evidence_fact_id — a string that must resolve to a
 * real graph fact row. run_agent() in agent-runner.ts checks this automatically:
 * if the output contains evidenceFactId and the caller passes a factExists hook,
 * the agent fails validation if the ID doesn't exist in the DB.
 *
 * Evidence fact IDs are provided in the context so the model can echo them back —
 * the model does NOT invent IDs; it selects from the ones supplied.
 *
 * No SEO scoring logic lives here — that's in seo-analysis-agent.ts (pure math).
 * This file is ONLY the agent contract + the one helper that calls it.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans, keywords } from "@/lib/db/schema";
import { runAgent, type AgentContract, type FactExistsCheck } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";

// ---------------------------------------------------------------------------
// Output schema (spec §3.6) — evidenceFactId is checked by run_agent()
// ---------------------------------------------------------------------------

export const SEORecommendationSchema = z.object({
  title:          z.string().max(120),
  description:    z.string(),
  evidenceFactId: z.string().min(1),          // must resolve to a real row — checked in run_agent()
  effortHours:    z.number().min(0.25).max(80),
  expectedImpact: z.enum(["low", "medium", "high"]),
});

export type SEORecommendation = z.infer<typeof SEORecommendationSchema>;

// ---------------------------------------------------------------------------
// Agent contract (spec §3.6)
// ---------------------------------------------------------------------------

export const SEO_RECOMMENDATION_AGENT: AgentContract<typeof SEORecommendationSchema> = {
  name:          "seo_recommendation_agent",
  model:         MODEL_ROUTES.seo_recommendation[0],
  fallbackModel: MODEL_ROUTES.seo_recommendation[1],
  systemPrompt:
    "You are an SEO expert writing actionable founder recommendations. " +
    "For the given issue, write a specific, concrete recommendation " +
    "that cites the exact graph fact that triggered it. " +
    "The evidenceFactId field MUST be one of the IDs from the 'availableEvidenceIds' " +
    "list provided in the context — do not invent an ID. " +
    "Output valid JSON only, no markdown fences.",
  outputSchema:  SEORecommendationSchema,
  maxRetries:    2,
};

// ---------------------------------------------------------------------------
// factExists hook — verifies evidenceFactId resolves to a real WebsiteScan or Keyword
// ---------------------------------------------------------------------------

const seoFactExists: FactExistsCheck = async (factId: string): Promise<boolean> => {
  // Check WebsiteScan first (most common for SEO issues)
  const [scan] = await db
    .select({ id: websiteScans.id })
    .from(websiteScans)
    .where(eq(websiteScans.id, factId))
    .limit(1);
  if (scan) return true;

  // Fallback: check Keyword (for keyword-gap recommendations)
  const [kw] = await db
    .select({ id: keywords.id })
    .from(keywords)
    .where(eq(keywords.id, factId))
    .limit(1);
  return !!kw;
};

// ---------------------------------------------------------------------------
// Main export — called by seo-analysis-agent.ts for each detected issue
// ---------------------------------------------------------------------------

export interface SeoIssueContext {
  issueType:           string;
  availableEvidenceIds: string[];   // caller supplies valid IDs; model picks one
  [key: string]: unknown;           // additional issue-specific context
}

export async function generateSeoRecommendation(
  ctx: SeoIssueContext,
): Promise<SEORecommendation> {
  return runAgent(SEO_RECOMMENDATION_AGENT, ctx, seoFactExists);
}
