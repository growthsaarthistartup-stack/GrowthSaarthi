/**
 * POST /api/content-drafts/publish
 *
 * Publishes a blog draft for the authenticated user and generates platform-specific
 * social media posts for each selected channel.
 *
 * Social copy is generated with platform-specific format:
 *   - LinkedIn: professional tone, longer text, hashtags
 *   - Twitter/X: concise, punchy, 280-char limit
 *   - Instagram: visual-first, emojis, lifestyle hashtags
 *   - Facebook: conversational, community-focused
 *   - YouTube: description-style, watch prompt
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentDrafts } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { logEvent } from "@/lib/telemetry";
import { requireStartupAuth } from "@/lib/api-auth";

/** Generate platform-specific social copy from blog title + excerpt */
function buildSocialCopy(
  platform: string,
  title: string,
  excerpt: string,
): string {
  const clean = (s: string) => s.replace(/[#*`_[\]]/g, "").trim().slice(0, 200);
  const t = clean(title);
  const e = clean(excerpt);

  switch (platform) {
    case "linkedin":
      return [
        `📢 New article: "${t}"`,
        "",
        e ? `${e}...` : "Read our latest insights on growth, SEO, and marketing.",
        "",
        "What's your take? Drop a comment below 👇",
        "",
        "#startup #growth #saas #contentmarketing #growthhacking",
      ].join("\n");

    case "twitter":
      // Keep under 280 chars
      const twitterBase = `🚀 "${t}" — ${e ? e.slice(0, 80) + "…" : "Read our latest article."} #startup #growth`;
      return twitterBase.slice(0, 280);

    case "instagram":
      return [
        `✨ "${t}"`,
        "",
        e ? `${e.slice(0, 150)}...` : "We just dropped something big for founders.",
        "",
        "Link in bio 🔗",
        "",
        "#startuplife #founders #growthhacks #digitalmarketing #saasfounder #entrepreneur",
      ].join("\n");

    case "facebook":
      return [
        `Hey everyone! 👋 We just published a new article:`,
        "",
        `"${t}"`,
        "",
        e ? `${e}...` : "Check it out and let us know what you think!",
        "",
        "Would love to hear your thoughts in the comments! 💬",
      ].join("\n");

    case "youtube":
      return [
        `📺 New Content Alert: "${t}"`,
        "",
        `In this piece we cover:`,
        e ? `• ${e}` : "• Key growth strategies for founders",
        `• Actionable steps you can implement today`,
        "",
        "Subscribe and hit the bell 🔔 for more startup growth content.",
        "#startup #growth #youtube",
      ].join("\n");

    default:
      return `📢 Just published: "${t}"\n\n${e ? e + "..." : ""}\n\n#startup #growth`;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  let body: {
    draftId?: string;
    platforms?: ("linkedin" | "youtube" | "facebook" | "instagram" | "twitter")[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { draftId, platforms = [] } = body;
  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }

  try {
    // Load and ownership-verify the blog draft
    const [draft] = await db
      .select()
      .from(contentDrafts)
      .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.startupId, startupId)))
      .limit(1);

    if (!draft) {
      return Response.json({ error: "Draft not found" }, { status: 404 });
    }

    // Parse draft content (stored as JSON string with title + content)
    let parsedContent: { title?: string; content?: string } = {};
    try {
      parsedContent = JSON.parse(draft.content || "{}");
    } catch {
      parsedContent = { title: "Blog Post", content: draft.content || "" };
    }

    const blogTitle   = parsedContent.title || "New Article";
    const blogExcerpt = (parsedContent.content || "").slice(0, 200);

    // Mark blog draft as published
    await db
      .update(contentDrafts)
      .set({ status: "published" })
      .where(eq(contentDrafts.id, draftId));

    // Generate platform-specific social posts
    const socialDraftRows = [];
    for (const platform of platforms) {
      const socialCopy = buildSocialCopy(platform, blogTitle, blogExcerpt);

      const [row] = await db
        .insert(contentDrafts)
        .values({
          id:               generateULID(),
          startupId,
          recommendationId: draft.recommendationId,
          type:             platform,
          content: JSON.stringify({
            title:    `${platform.charAt(0).toUpperCase() + platform.slice(1)} Post — ${blogTitle}`,
            content:  socialCopy,
            sourceUrl: null, // real platform URL would be populated after actual OAuth posting
            note:     "Ready to copy-paste or schedule via your social media tool.",
          }),
          status: "approved", // saved as approved draft ready to copy or post
        })
        .returning();

      socialDraftRows.push(row);
    }

    // Log telemetry
    await logEvent(startupId, "integration_connected", {
      draftId,
      platformCount: platforms.length,
      platforms,
    });

    return Response.json({
      ok:                 true,
      publishedDraftId:   draftId,
      socialDraftsCount:  socialDraftRows.length,
      socialDraftIds:     socialDraftRows.map(r => r.id),
      platforms,
      note: socialDraftRows.length > 0
        ? "Platform-specific social posts generated and saved as drafts. Copy them from the Social Drafts tab."
        : undefined,
    });
  } catch (err) {
    console.error("[publish-blog api] failed:", err);
    return Response.json({ error: "Failed to publish blog" }, { status: 500 });
  }
}
