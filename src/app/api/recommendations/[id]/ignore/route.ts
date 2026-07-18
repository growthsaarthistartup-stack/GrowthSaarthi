/**
 * POST /api/recommendations/[id]/ignore
 *
 * Pipeline:
 *   1. Load recommendation
 *   2. Write FeedbackSignal (action="ignored")
 *   3. Update recommendation status → "ignored"
 *   4. adjustWeights() — negative signal reduces future recs in this category
 *   5. Log "plan_item_ignored"
 *
 * No ExecutionGate call — ignoring never triggers a side effect.
 *
 * Request body: { startupId: string }
 * Response: { ok: true, trustLevel: number }
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations, feedbackSignals } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { getTrustLevel, adjustWeights } from "@/lib/trust-ladder";
import { logEvent } from "@/lib/telemetry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: recId } = await params;

  let body: { startupId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupId } = body;
  if (!startupId) return Response.json({ error: "startupId required" }, { status: 400 });

  // ── 1. Load recommendation ──────────────────────────────────────────────
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.id, recId), eq(recommendations.startupId, startupId)))
    .limit(1);

  if (!rec) return Response.json({ error: "Recommendation not found" }, { status: 404 });

  const category = rec.category;

  // ── 2. FeedbackSignal ──────────────────────────────────────────────────
  const iKey = buildIdempotencyKey("FeedbackSignal", startupId, `${recId}:ignored`, todayWindow());

  await db
    .insert(feedbackSignals)
    .values({
      id:               generateULID(),
      startupId,
      recommendationId: recId,
      idempotencyKey:   iKey,
      action:           "ignored",
      category,
    })
    .onConflictDoNothing();

  // ── 3. Update recommendation status ────────────────────────────────────
  await db
    .update(recommendations)
    .set({ status: "ignored" })
    .where(eq(recommendations.id, recId));

  // ── 4. Adjust weights ─────────────────────────────────────────────────
  await adjustWeights(startupId, category, "ignored");

  // ── 5. Telemetry ──────────────────────────────────────────────────────
  const trustLevel = await getTrustLevel(startupId, category);
  await logEvent(startupId, "plan_item_ignored", { recId, category });

  return Response.json({ ok: true, trustLevel });
}
