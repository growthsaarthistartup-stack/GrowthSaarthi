/**
 * POST /api/content-drafts/suggest-topics
 *
 * Suggests blog topics and keywords based on the latest website scan.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans } from "@/lib/db/schema";
import { suggestBlogTopics } from "@/lib/agents/topic-suggest-agent";

export async function POST(request: NextRequest): Promise<Response> {
  let body: { startupId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupId } = body;
  if (!startupId) return Response.json({ error: "startupId required" }, { status: 400 });

  // Get latest scan
  const [latestScan] = await db
    .select()
    .from(websiteScans)
    .where(eq(websiteScans.startupId, startupId))
    .orderBy(desc(websiteScans.createdAt))
    .limit(1);

  if (!latestScan) {
    // If no scans exist, return high-quality fallback topics
    return Response.json({
      ok: true,
      suggestions: [
        {
          title: "How to Bootstrap Your SaaS Brand in 30 Days",
          keywords: ["saas bootstrap", "growth marketing", "content strategy"],
          reason: "Aligns with early-stage growth and acquisition goals."
        },
        {
          title: "The Ultimate Guide to Product-Led Growth for Startups",
          keywords: ["product led growth", "plg strategy", "conversion rates"],
          reason: "Addresses SaaS scalability and customer lifetime value."
        },
        {
          title: "5 SEO Strategies B2B SaaS Startups Must Implement Early",
          keywords: ["b2b saas seo", "organic traffic", "ranking guide"],
          reason: "Complements your technical website structure and optimization metrics."
        }
      ]
    });
  }

  try {
    const results = await suggestBlogTopics({
      title:           latestScan.title,
      h1:              latestScan.h1,
      metaDescription: latestScan.metaDescription,
      techStack:       latestScan.techStack || [],
    });
    return Response.json({ ok: true, suggestions: results.suggestions });
  } catch (err) {
    console.error("[suggest-topics api] failed:", err);
    return Response.json({ error: "LLM agent failed to generate suggestions" }, { status: 500 });
  }
}
