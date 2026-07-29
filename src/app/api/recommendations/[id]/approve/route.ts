/**
 * POST /api/recommendations/[id]/approve
 *
 * Pipeline (spec §7):
 *   1. Load the recommendation → validate it exists and belongs to the startup
 *   2. Write FeedbackSignal (action="approved")
 *   3. Update recommendation status → "approved"
 *   4. adjustWeights() — currently logged; Phase 3 wires real calibration
 *   5. Update trust ladder (re-computed from DB on next getTrustLevel call)
 *   6. Kick off execution via ExecutionGate:
 *      • content_blog  → generateBlogDraft()   via ExecutionGate (always queued)
 *      • content_social→ generateSocialDraft()  via ExecutionGate (always queued)
 *      • seo / seo_metadata → goes through ExecutionGate (AUTO_SAFE at L4)
 *      • all others    → queued for confirmation
 *   7. Log telemetry event "plan_item_approved"
 *
 * Request body: { startupId: string, category?: string }
 * Response: { ok: true, trustLevel: number, dispatched: "direct"|"confirmation", draftId?: string }
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
import { requireStartupAuth } from "@/lib/api-auth";

// category → ExecutionGate action_risk mapping
function actionRisk(category: string): string {
  if (["content_blog", "content_social"].includes(category)) return "publish_content";
  if (category === "email_outreach") return "email_customers";
  if (category === "pricing")        return "change_pricing";
  return "seo_metadata"; // seo, landing_page, monitoring → treated as safe metadata
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Auth guard — startupId from session prevents IDOR
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  const { id: recId } = await params;

  // ── 1. Load recommendation ──────────────────────────────────────────────
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.id, recId), eq(recommendations.startupId, startupId)))
    .limit(1);

  if (!rec) return Response.json({ error: "Recommendation not found" }, { status: 404 });

  const category = rec.category;

  // ── 2. Write FeedbackSignal ─────────────────────────────────────────────
  const iKey = buildIdempotencyKey("FeedbackSignal", startupId, `${recId}:approved`, todayWindow());
  await db
    .insert(feedbackSignals)
    .values({
      id:               generateULID(),
      startupId,
      recommendationId: recId,
      idempotencyKey:   iKey,
      action:           "approved",
      category,
    })
    .onConflictDoNothing();

  // ── 3. Update recommendation status ────────────────────────────────────
  await db
    .update(recommendations)
    .set({ status: "approved" })
    .where(eq(recommendations.id, recId));

  // ── 4. Adjust weights ──────────────────────────────────────────────────
  await adjustWeights(startupId, category, "approved");

  // ── 5. Current trust level (for response) ─────────────────────────────
  const trustLevel = await getTrustLevel(startupId, category);

  // ── 6. Kick off execution via ExecutionGate ───────────────────────────
  let dispatched: "direct" | "confirmation" = "confirmation";
  let draftId: string | undefined;

  try {
    const topic = rec.title; // use recommendation title as content topic

    if (category === "content_blog" || category === "content") {
      // Blog draft — always queued (publish_content is irreversible, content_blog not AUTO_SAFE)
      const gateResult = await executionGate.executeAction(
        startupId,
        "content_blog",
        "publish_content",
        () => generateBlogDraft(startupId, recId, topic),
      );
      dispatched = gateResult.dispatched;
      if (gateResult.dispatched === "confirmation") {
        // Gate said queue — run the draft agent now so the ContentDraft row exists
        const draft = await generateBlogDraft(startupId, recId, topic);
        draftId = draft?.id;
      }

    } else if (category === "content_social" || category === "seo_blog") {
      const gateResult = await executionGate.executeAction(
        startupId,
        "content_social",
        "publish_content",
        () => generateSocialDraft(startupId, recId, topic),
      );
      dispatched = gateResult.dispatched;
      if (gateResult.dispatched === "confirmation") {
        const draft = await generateSocialDraft(startupId, recId, topic);
        draftId = draft?.id;
      }

    } else {
      // seo_metadata, landing_page, competitor_gap, etc.
      const risk = actionRisk(category);
      const gateResult = await executionGate.executeAction(
        startupId,
        category === "seo" ? "seo_metadata" : category,
        risk,
        async () => ({ queued: true }), // placeholder — real execution agents in Phase 4
      );
      dispatched = gateResult.dispatched;
    }
  } catch (err) {
    if (err instanceof ExecutionBlocked) {
      // Blocked by trust gate — not an error, expected at low trust levels
      return Response.json({
        ok:          true,
        trustLevel,
        dispatched:  "blocked",
        reason:      err.message,
      });
    }
    console.error("[approve-route] ExecutionGate error:", err);
  }

  // ── 7. Telemetry ──────────────────────────────────────────────────────
  await logEvent(startupId, "plan_item_approved", { recId, category, trustLevel });

  return Response.json({ ok: true, trustLevel, dispatched, draftId });
}
