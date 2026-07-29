/**
 * GET /api/content-drafts
 * Returns content drafts for the authenticated user's startup, optionally filtered by type.
 */

import type { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentDrafts } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  const type = request.nextUrl.searchParams.get("type");

  try {
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
  } catch (err) {
    console.error("[api/content-drafts] DB error:", err);
    return Response.json({ error: "Failed to fetch content drafts" }, { status: 500 });
  }
}
