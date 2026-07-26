/**
 * GET /api/alerts?startupId=xxx
 *
 * Returns all alerts for a startup, newest first.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");
  if (!startupId) {
    return Response.json({ error: "startupId required" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    // Mock alerts for demo mode
    return Response.json({ ok: true, alerts: [
      { id: "mock_1", metricType: "revenue", zScore: -3.5, severity: "critical",
        message: "Payment failed: $49.00 invoice for customer cus_demo", acknowledged: false,
        source: "stripe_realtime", createdAt: new Date().toISOString() },
      { id: "mock_2", metricType: "sessions", zScore: -2.3, severity: "warning",
        message: "Sessions dropped 38% below 28-day baseline", acknowledged: false,
        source: "zscore_batch", createdAt: new Date().toISOString() },
    ] });
  }

  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.startupId, startupId))
    .orderBy(desc(alerts.createdAt));

  return Response.json({ ok: true, alerts: rows });
}
