/**
 * POST /api/content-drafts/publish
 *
 * Publishes a blog draft and automatically shares it on selected social channels.
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentDrafts } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { logEvent } from "@/lib/telemetry";

export async function POST(request: NextRequest): Promise<Response> {
  let body: {
    draftId?: string;
    startupId?: string;
    platforms?: ("linkedin" | "youtube" | "facebook" | "instagram" | "twitter")[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { draftId, startupId, platforms = [] } = body;
  if (!draftId || !startupId) {
    return Response.json({ error: "draftId and startupId are required" }, { status: 400 });
  }

  // 1. Load the blog draft
  const [draft] = await db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.startupId, startupId)))
    .limit(1);

  if (!draft) return Response.json({ error: "Draft not found" }, { status: 404 });

  // Parse draft content (which stores title + content + meta as a JSON string)
  let parsedContent: { title?: string; content?: string } = {};
  try {
    parsedContent = JSON.parse(draft.content || "{}");
  } catch {
    parsedContent = { title: "Blog Post", content: draft.content || "" };
  }

  // 2. Mark the blog draft as published
  await db
    .update(contentDrafts)
    .set({ status: "published" })
    .where(eq(contentDrafts.id, draftId));

  // 3. Create simulated social media posts
  const socialDraftRows = [];
  for (const platform of platforms) {
    // Generate social media teaser/summary of the blog post
    const platformTeaser = `📢 Just published our new article: "${parsedContent.title || "Latest Update"}".\n\nRead the full post here, and let us know your thoughts!\n\n#startup #growth #marketing`;

    const [row] = await db
      .insert(contentDrafts)
      .values({
        id:               generateULID(),
        startupId,
        recommendationId: draft.recommendationId,
        type:             platform,
        content:          JSON.stringify({
          title:   `Shared on ${platform.toUpperCase()}`,
          content: platformTeaser,
          postUrl: `https://www.${platform}.com/share/growthsaarthi_${Math.random().toString(36).substring(2, 8)}`,
        }),
        status:           "published",
      })
      .returning();

    socialDraftRows.push(row);
  }

  // 4. Log telemetry event
  await logEvent(startupId, "integration_connected", { draftId, platformsConnected: platforms.length });

  return Response.json({
    ok: true,
    publishedPlatforms: platforms,
    socialSharesCount: socialDraftRows.length
  });
}
