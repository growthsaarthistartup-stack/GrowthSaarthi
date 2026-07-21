/**
 * GET /api/recommendations?startupId=X&category=seo
 * Returns all recommendations for a given startup, optionally filtered by category.
 */

import type { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");
  const category  = request.nextUrl.searchParams.get("category");

  if (!startupId) {
    return Response.json({ error: "startupId is required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(recommendations)
    .where(
      category
        ? and(eq(recommendations.startupId, startupId), eq(recommendations.category, category))
        : eq(recommendations.startupId, startupId),
    )
    .orderBy(desc(recommendations.priorityScore))
    .limit(20);

  return Response.json({ ok: true, recommendations: rows });
}
