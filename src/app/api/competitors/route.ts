/**
 * GET /api/competitors?startupId=X
 * Returns all competitors discovered for a given startup.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { competitors } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");

  if (!startupId) {
    return Response.json({ error: "startupId is required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.startupId, startupId))
    .orderBy(desc(competitors.detectedAt))
    .limit(10);

  return Response.json({ ok: true, competitors: rows });
}
