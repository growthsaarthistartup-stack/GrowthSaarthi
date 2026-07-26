/**
 * GET /api/positioning-gaps?startupId=xxx
 *
 * Returns positioning gaps for a startup (from the positioning_gaps table,
 * populated by the competitor agent's POSITIONING_GAP_AGENT).
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { positioningGaps } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");
  if (!startupId) {
    return Response.json({ error: "startupId required" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ ok: true, gaps: [
      { id: "mock_g1", gapDescription: "Competitors emphasise \"no-code\" setup — your hero copy doesn't mention setup time.", opportunity: "Add a \"Live in 5 minutes\" badge to your hero section.", confidence: 0.85 },
      { id: "mock_g2", gapDescription: "All 3 competitors surface enterprise security badges (SOC2, GDPR) above the fold.", opportunity: "Add trust signals near your primary CTA.", confidence: 0.72 },
    ] });
  }

  const rows = await db
    .select()
    .from(positioningGaps)
    .where(eq(positioningGaps.startupId, startupId))
    .orderBy(desc(positioningGaps.createdAt));

  return Response.json({ ok: true, gaps: rows });
}
