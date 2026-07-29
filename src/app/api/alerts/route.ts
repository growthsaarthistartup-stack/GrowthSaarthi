/**
 * GET /api/alerts?startupId=X  →  GET /api/alerts
 * Returns all alerts for the authenticated user's startup, newest first.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.startupId, startupId))
      .orderBy(desc(alerts.createdAt));

    return Response.json({ ok: true, alerts: rows });
  } catch (err) {
    console.error("[api/alerts] DB error:", err);
    return Response.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}
