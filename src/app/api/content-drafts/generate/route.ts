/**
 * POST /api/content-drafts/generate
 *
 * Runs the Blog Draft Agent to write a blog post on a specific topic.
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";
import { generateBlogDraft } from "@/lib/agents/blog-draft-agent";

export async function POST(request: NextRequest): Promise<Response> {
  let body: { startupId?: string; topic?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupId, topic } = body;
  if (!startupId || !topic) {
    return Response.json({ error: "startupId and topic are required" }, { status: 400 });
  }

  try {
    // Generate draft using the Blog Draft Agent.
    const recId = "user_trig_" + Math.random().toString(36).substring(2, 10);
    
    // Insert dummy recommendation row first to satisfy foreign key constraint
    await db
      .insert(recommendations)
      .values({
        id:                 recId,
        startupId,
        category:           "content_blog",
        title:              topic.split("\n")[0].replace(/^Title:\s*/i, "") || "Custom Blog",
        description:        `User-initiated blog generation: ${topic}`,
        evidenceFactIds:    [],
        impactScore:        1.0,
        confidenceScore:    1.0,
        effortScore:        0.5,
        priorityScore:      1.0,
        status:             "approved",
      })
      .onConflictDoNothing();

    const draft = await generateBlogDraft(startupId, recId, topic);

    if (!draft) {
      return Response.json({ error: "Blog Draft Agent failed to generate post" }, { status: 500 });
    }

    return Response.json({ ok: true, draft });
  } catch (err) {
    console.error("[generate-blog api] failed:", err);
    return Response.json({ error: "Server error during draft generation" }, { status: 500 });
  }
}
