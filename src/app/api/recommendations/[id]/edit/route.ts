/**
 * POST /api/recommendations/[id]/edit
 *
 * Pipeline:
 *   1. Load recommendation
 *   2. Write FeedbackSignal (action="edited", editDeltaChars = |newTitle| - |oldTitle|)
 *   3. Update recommendation title + status → "edited"
 *   4. adjustWeights() — treated as a positive signal (founder engaged)
 *   5. Same ExecutionGate path as approve — the edited version is what gets drafted
 *   6. Log "plan_item_approved" (edit counts as approval for telemetry)
 *
 * Request body: { startupId: string, newTitle: string }
 * Response: { ok: true, trustLevel: number, dispatched: "direct"|"confirmation" }
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations, feedbackSignals } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { getTrustLevel, adjustWeights } from "@/lib/trust-ladder";
import { executionGate, ExecutionBlocked } from "@/lib/execution-gate";
import { generateBlogDraft } from "@/lib/agents/blog-draft-agent";
import { generateSocialDraft } from "@/lib/agents/social-draft-agent";
import { logEvent } from "@/lib/telemetry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: recId } = await params;

  let body: { startupId?: string; newTitle?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupId, newTitle } = body;
  if (!startupId) return Response.json({ error: "startupId required" }, { status: 400 });
  if (!newTitle?.trim()) return Response.json({ error: "newTitle required" }, { status: 400 });

  // ── 1. Load recommendation ──────────────────────────────────────────────
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.id, recId), eq(recommendations.startupId, startupId)))
    .limit(1);

  if (!rec) return Response.json({ error: "Recommendation not found" }, { status: 404 });

  const category = rec.category;

  // ── 2. FeedbackSignal ──────────────────────────────────────────────────
  const iKey = buildIdempotencyKey("FeedbackSignal", startupId, `${recId}:edited`, todayWindow());

  const editDelta = Math.abs(newTitle.length - (rec.title?.length ?? 0));

  await db
    .insert(feedbackSignals)
    .values({
      id:               generateULID(),
      startupId,
      recommendationId: recId,
      idempotencyKey:   iKey,
      action:           "edited",
      editDeltaChars:   editDelta,
      category,
    })
    .onConflictDoNothing();

  // ── 3. Update recommendation ──────────────────────────────────────────
  await db
    .update(recommendations)
    .set({ status: "edited", title: newTitle.trim() })
    .where(eq(recommendations.id, recId));

  // ── 4. Adjust weights ─────────────────────────────────────────────────
  await adjustWeights(startupId, category, "edited");

  // ── 5. Trust level ────────────────────────────────────────────────────
  const trustLevel = await getTrustLevel(startupId, category);

  // ── 6. ExecutionGate — same as approve, but topic uses the edited title ─
  let dispatched: "direct" | "confirmation" | "blocked" = "confirmation";
  let draftId: string | undefined;
  const topic = newTitle.trim();

  try {
    if (category === "content_blog" || category === "content") {
      await executionGate.executeAction(startupId, "content_blog", "publish_content", async () => null);
      dispatched = "confirmation";
      const draft = await generateBlogDraft(startupId, recId, topic);
      draftId = draft?.id;

    } else if (category === "content_social" || category === "seo_blog") {
      await executionGate.executeAction(startupId, "content_social", "publish_content", async () => null);
      dispatched = "confirmation";
      const draft = await generateSocialDraft(startupId, recId, topic);
      draftId = draft?.id;

    } else {
      const risk = ["email_outreach"].includes(category) ? "email_customers"
        : ["pricing"].includes(category) ? "change_pricing"
        : "seo_metadata";
      const gateResult = await executionGate.executeAction(
        startupId,
        category === "seo" ? "seo_metadata" : category,
        risk,
        async () => ({ queued: true }),
      );
      dispatched = gateResult.dispatched;
    }
  } catch (err) {
    if (err instanceof ExecutionBlocked) {
      dispatched = "blocked";
    } else {
      console.error("[edit-route] ExecutionGate error:", err);
    }
  }

  await logEvent(startupId, "plan_item_approved", { recId, category, trustLevel, edited: true });

  return Response.json({ ok: true, trustLevel, dispatched, draftId });
}
