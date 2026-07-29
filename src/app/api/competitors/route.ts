/**
 * GET /api/competitors
 * Returns competitors for the authenticated user's startup.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { competitors } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    const rows = await db
      .select()
      .from(competitors)
      .where(eq(competitors.startupId, startupId))
      // BUG-6 FIX: ULID ordering (ms-precision) is stable vs detectedAt batches
      .orderBy(desc(competitors.id))
      .limit(12);

    return Response.json({ ok: true, competitors: rows });
  } catch (err) {
    console.error("[api/competitors] DB error:", err);
    return Response.json({ error: "Failed to fetch competitors" }, { status: 500 });
  }
}
