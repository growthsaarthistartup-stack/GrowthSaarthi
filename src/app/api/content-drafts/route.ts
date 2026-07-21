/**
 * GET /api/content-drafts?startupId=X&type=blog
 * Returns content drafts for a given startup, optionally filtered by type.
 */

import type { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentDrafts } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");
  const type      = request.nextUrl.searchParams.get("type");

  if (!startupId) {
    return Response.json({ error: "startupId is required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(contentDrafts)
    .where(
      type
        ? and(eq(contentDrafts.startupId, startupId), eq(contentDrafts.type, type as "blog" | "linkedin" | "facebook"))
        : eq(contentDrafts.startupId, startupId),
    )
    .orderBy(desc(contentDrafts.createdAt))
    .limit(20);

  return Response.json({ ok: true, drafts: rows });
}
