/**
 * PATCH /api/alerts/[id]/acknowledge
 *
 * Marks an alert as acknowledged and sets acknowledged_at timestamp.
 * Used by the Alerts tab acknowledge button.
 */

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: "Alert ID required" }, { status: 400 });
  }

  const [updated] = await db
    .update(alerts)
    .set({
      acknowledged:   true,
      acknowledgedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning({ id: alerts.id, acknowledged: alerts.acknowledged });

  if (!updated) {
    return Response.json({ error: "Alert not found" }, { status: 404 });
  }

  return Response.json({ ok: true, id: updated.id });
}
