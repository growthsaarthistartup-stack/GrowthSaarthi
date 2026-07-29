/**
 * GET /api/recommendations
 * Returns all recommendations for the authenticated user's startup.
 */

import type { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  const category = request.nextUrl.searchParams.get("category");

  try {
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
  } catch (err) {
    console.error("[api/recommendations] DB error:", err);
    return Response.json({ error: "Failed to fetch recommendations" }, { status: 500 });
  }
}
