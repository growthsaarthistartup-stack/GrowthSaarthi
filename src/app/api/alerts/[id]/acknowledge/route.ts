/**
 * PATCH /api/alerts/[id]/acknowledge
 *
 * Marks an alert as acknowledged. Validates that the alert belongs to the
 * authenticated user's startup before mutating (prevents IDOR).
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Alert ID required" }, { status: 400 });
  }

  try {
    // Ownership check: ensure the alert belongs to THIS user's startup
    const [updated] = await db
      .update(alerts)
      .set({
        acknowledged:   true,
        acknowledgedAt: new Date(),
      })
      .where(and(eq(alerts.id, id), eq(alerts.startupId, startupId)))
      .returning({ id: alerts.id, acknowledged: alerts.acknowledged });

    if (!updated) {
      return Response.json({ error: "Alert not found" }, { status: 404 });
    }

    return Response.json({ ok: true, id: updated.id });
  } catch (err) {
    console.error("[api/alerts/acknowledge] DB error:", err);
    return Response.json({ error: "Failed to acknowledge alert" }, { status: 500 });
  }
}
