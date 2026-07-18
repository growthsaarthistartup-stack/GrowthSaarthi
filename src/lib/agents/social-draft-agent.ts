/**
 * Social Draft Agent — generates platform-specific social copy (LinkedIn, Twitter/X)
 * using the startup's BrandVoice.
 *
 * Model: social_draft (deepseek/deepseek-v4-flash:free, fallback llama-4-maverick)
 * Output → ContentDraft row with type="linkedin" or "facebook", status="pending_approval".
 *
 * Like blog-draft-agent, this NEVER publishes. action_risk="publish_content" means
 * ExecutionGate always queues for confirmation (content_social is never in AUTO_SAFE).
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  brandVoices,
  contentDrafts,
  startups,
} from "@/lib/db/schema";
import { runAgent, type AgentContract } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const SocialDraftSchema = z.object({
  platform: z.enum(["linkedin", "twitter", "facebook"]),
  copy:     z.string().min(20).max(3000),
  hashtags: z.array(z.string()).max(10).optional(),
  hook:     z.string().max(280).optional(),   // first sentence — the scroll-stopper
});

type SocialDraft = z.infer<typeof SocialDraftSchema>;

// ---------------------------------------------------------------------------
// Agent contract
// ---------------------------------------------------------------------------

const SOCIAL_DRAFT_AGENT: AgentContract<typeof SocialDraftSchema> = {
  name:          "social_draft_agent",
  model:         MODEL_ROUTES.social_draft[0],
  fallbackModel: MODEL_ROUTES.social_draft[1],
  systemPrompt:
    "You are a B2B SaaS social media strategist. " +
    "Write a platform-native social post for the given topic and platform. " +
    "LinkedIn: professional, insight-led, 150-300 words, paragraph breaks. " +
    "Twitter: punchy, hook in first line, max 280 chars per tweet. " +
    "Match the brand voice exactly. " +
    "Output valid JSON only, no markdown fences.",
  outputSchema: SocialDraftSchema,
  maxRetries:   2,
};

// ---------------------------------------------------------------------------
// Platform → ContentDraft type mapping
// ---------------------------------------------------------------------------

const PLATFORM_TYPE: Record<string, "linkedin" | "facebook"> = {
  linkedin: "linkedin",
  facebook: "facebook",
  twitter:  "facebook",   // twitter not in contentTypeEnum — use facebook as closest
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateSocialDraft(
  startupId: string,
  recommendationId: string,
  topic: string,
  platform: "linkedin" | "twitter" | "facebook" = "linkedin",
): Promise<typeof contentDrafts.$inferSelect | null> {
  try {
    // ── Load brand voice ──────────────────────────────────────────────────
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

    const tone     = bv?.tone ?? "professional, conversational";
    const examples = bv?.examplesJson
      ? (JSON.parse(bv.examplesJson) as string[]).slice(0, 2)
      : [];
    const avoid    = bv?.avoidJson
      ? (JSON.parse(bv.avoidJson) as string[])
      : ["corporate jargon", "hype words"];

    // ── Run agent ────────────────────────────────────────────────────────
    const draft: SocialDraft = await runAgent(SOCIAL_DRAFT_AGENT, {
      startupName:    startup?.name ?? startupId,
      topic,
      platform,
      tone,
      examplePhrases: examples,
      avoid,
    });

    // ── Write ContentDraft (pending_approval — never auto-published) ──────
    const iKey = buildIdempotencyKey(
      "SocialDraft", startupId, `${recommendationId}:${platform}`, todayWindow(),
    );


    const contentType = PLATFORM_TYPE[draft.platform] ?? "linkedin";

    const [row] = await db
      .insert(contentDrafts)
      .values({
        id:               generateULID(),
        startupId,
        recommendationId,
        idempotencyKey:   iKey,
        type:             contentType,
        content:          JSON.stringify(draft),
        status:           "pending_approval",
      })
      .onConflictDoNothing()
      .returning();

    return row ?? null;
  } catch (err) {
    console.error("[social-draft-agent] failed:", err);
    return null;
  }
}
