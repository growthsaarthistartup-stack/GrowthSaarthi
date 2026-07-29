/**
 * GET /api/positioning-gaps
 *
 * Returns positioning gaps for the authenticated user's startup.
 * Populated by the competitor agent's POSITIONING_GAP_AGENT.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { positioningGaps } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    const rows = await db
      .select()
      .from(positioningGaps)
      .where(eq(positioningGaps.startupId, startupId))
      .orderBy(desc(positioningGaps.createdAt));

    return Response.json({ ok: true, gaps: rows });
  } catch (err) {
    console.error("[api/positioning-gaps] DB error:", err);
    return Response.json({ error: "Failed to fetch positioning gaps" }, { status: 500 });
  }
}
