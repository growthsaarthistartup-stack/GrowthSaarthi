/**
 * Blog Draft Agent — generates a full blog post using the startup's BrandVoice.
 *
 * Model: blog_final_draft (meta-llama/llama-4-maverick:free, fallback deepseek)
 * Output → ContentDraft row with type="blog", status="pending_approval".
 *
 * The agent never publishes. It always goes through ExecutionGate which, for
 * category "content_blog", action_risk "publish_content", queues for confirmation
 * (never AUTO_SAFE — spec §7). The ContentDraft row IS the queue entry.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  brandVoices,
  contentDrafts,
  recommendations,
  startups,
} from "@/lib/db/schema";
import { runAgent, type AgentContract } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const BlogDraftSchema = z.object({
  title:       z.string().max(160),
  content:     z.string().min(200),   // minimum viable blog post
  metaTitle:   z.string().max(60).optional(),
  metaDesc:    z.string().max(160).optional(),
});

type BlogDraft = z.infer<typeof BlogDraftSchema>;

// ---------------------------------------------------------------------------
// Agent contract
// ---------------------------------------------------------------------------

const BLOG_DRAFT_AGENT: AgentContract<typeof BlogDraftSchema> = {
  name:          "blog_draft_agent",
  model:         MODEL_ROUTES.blog_final_draft[0],
  fallbackModel: MODEL_ROUTES.blog_final_draft[1],
  systemPrompt:
    "You are a senior content writer producing a full blog post for a B2B SaaS startup. " +
    "Match the brand voice exactly (tone, vocabulary, avoid list). " +
    "Write for the target keyword/topic provided. " +
    "The post must be founder-authentic — no generic filler phrases. " +
    "Output valid JSON only, no markdown fences.",
  outputSchema: BlogDraftSchema,
  maxRetries:   2,
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateBlogDraft(
  startupId: string,
  recommendationId: string,
  topic: string,
): Promise<typeof contentDrafts.$inferSelect | null> {
  try {
    // ── Load brand voice (falls back to startup name if no BV row yet) ──────
    const [bv] = await db
      .select()
      .from(brandVoices)
      .where(eq(brandVoices.startupId, startupId))
      .limit(1);

    const [startup] = await db
      .select({ name: startups.name })
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);

    const tone     = bv?.tone ?? "professional, direct, founder-first";
    const examples = bv?.examplesJson
      ? (JSON.parse(bv.examplesJson) as string[]).slice(0, 3)
      : [];
    const avoid    = bv?.avoidJson
      ? (JSON.parse(bv.avoidJson) as string[])
      : ["buzzwords", "passive voice"];

    // ── Run agent ────────────────────────────────────────────────────────────
    const draft: BlogDraft = await runAgent(BLOG_DRAFT_AGENT, {
      startupName:   startup?.name ?? startupId,
      topic,
      tone,
      examplePhrases: examples,
      avoid,
    });

    // ── Idempotency — don't double-write if the same rec was approved twice ─
    const iKey = buildIdempotencyKey("BlogDraft", startupId, recommendationId, todayWindow());

    const [row] = await db
      .insert(contentDrafts)
      .values({
        id:               generateULID(),
        startupId,
        recommendationId,
        idempotencyKey:   iKey,
        type:             "blog",
        content:          JSON.stringify(draft),   // title + content + meta stored as JSON
        status:           "pending_approval",
      })
      .onConflictDoNothing()
      .returning();

    return row ?? null;
  } catch (err) {
    console.error("[blog-draft-agent] failed:", err);
    return null;
  }
}
