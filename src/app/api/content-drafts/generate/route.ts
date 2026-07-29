/**
 * POST /api/content-drafts/generate
 *
 * Runs the Blog Draft Agent to write a blog post on a specific topic for
 * the authenticated user's startup.
 */

import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";
import { generateBlogDraft } from "@/lib/agents/blog-draft-agent";
import { requireStartupAuth } from "@/lib/api-auth";
import { generateULID } from "@/lib/ulid";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  let body: { topic?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { topic } = body;
  if (!topic?.trim()) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  try {
    // Create a user-initiated recommendation row to satisfy the FK constraint
    const recId = `utrig_${generateULID()}`;

    await db
      .insert(recommendations)
      .values({
        id:             recId,
        startupId,
        category:       "content_blog",
        title:          topic.split("\n")[0].replace(/^Title:\s*/i, "").trim() || "Custom Blog Post",
        description:    `User-initiated blog generation: ${topic}`,
        evidenceFactIds:  [],
        impactScore:    1.0,
        confidenceScore: 1.0,
        effortScore:    0.5,
        priorityScore:  1.0,
        status:         "approved",
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
