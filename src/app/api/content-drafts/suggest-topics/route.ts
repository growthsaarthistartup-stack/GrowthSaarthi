/**
 * POST /api/content-drafts/suggest-topics
 *
 * Suggests blog topics and keywords based on the authenticated user's latest
 * website scan. Uses the LLM topic-suggest agent when scan data is available,
 * or returns curated fallback topics personalised to the startup's industry/stage.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans, startups } from "@/lib/db/schema";
import { suggestBlogTopics } from "@/lib/agents/topic-suggest-agent";
import { requireStartupAuth } from "@/lib/api-auth";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    // Get startup for industry / stage context
    const [startup] = await db
      .select({ industry: startups.industry, stage: startups.stage, name: startups.name })
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);

    // Get latest website scan
    const [latestScan] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.startupId, startupId))
      .orderBy(desc(websiteScans.createdAt))
      .limit(1);

    if (!latestScan) {
      // No scan yet — generate contextual fallback topics using startup metadata
      const industry = startup?.industry || "SaaS";
      const stage = startup?.stage || "mvp";
      return Response.json({
        ok: true,
        source: "fallback",
        suggestions: [
          {
            title: `How ${industry} Startups Can Drive Growth in 30 Days`,
            keywords: [`${industry.toLowerCase()} growth`, "startup marketing", "growth strategy"],
            reason: `Directly relevant to your ${industry} industry and ${stage} stage.`,
          },
          {
            title: "The Complete Guide to Product-Led Growth for Startups",
            keywords: ["product led growth", "plg strategy", "conversion rates"],
            reason: "Addresses SaaS scalability and customer lifetime value — high organic intent.",
          },
          {
            title: `5 SEO Strategies Every ${industry} Founder Must Know`,
            keywords: [`${industry.toLowerCase()} seo`, "organic traffic", "keyword ranking"],
            reason: "Complements your website structure and captures high-intent search traffic.",
          },
        ],
      });
    }

    // Real scan data available — call LLM topic suggest agent
    const results = await suggestBlogTopics({
      title:           latestScan.title,
      h1:              latestScan.h1,
      metaDescription: latestScan.metaDescription,
      techStack:       latestScan.techStack || [],
    });

    return Response.json({ ok: true, source: "llm_scan", suggestions: results.suggestions });
  } catch (err) {
    console.error("[suggest-topics api] failed:", err);
    return Response.json({ error: "Failed to generate topic suggestions" }, { status: 500 });
  }
}
