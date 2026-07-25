/**
 * GET /api/integrations?startupId=X
 * POST /api/integrations
 *
 * Manages OAuth connections (or simulated details) for marketing integrations.
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { integrations } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";

export async function GET(request: NextRequest): Promise<Response> {
  const startupId = request.nextUrl.searchParams.get("startupId");
  if (!startupId) return Response.json({ error: "startupId required" }, { status: 400 });

  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.startupId, startupId));

  return Response.json({ ok: true, integrations: rows });
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: {
    startupId?: string;
    type?: "linkedin" | "youtube" | "facebook" | "instagram" | "twitter";
    connected?: boolean;
    accessToken?: string;
    scopesJson?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startupId, type, connected = false, accessToken = "", scopesJson = "{}" } = body;
  if (!startupId || !type) {
    return Response.json({ error: "startupId and type are required" }, { status: 400 });
  }

  // Find existing integration row
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.startupId, startupId), eq(integrations.type, type)))
    .limit(1);

  if (existing) {
    // Update it
    const [row] = await db
      .update(integrations)
      .set({
        connected,
        accessToken:  connected ? accessToken : null,
        scopesJson:   connected ? scopesJson : null,
        connectedAt:  connected ? new Date() : null,
        updatedAt:    new Date(),
      })
      .where(eq(integrations.id, existing.id))
      .returning();
    return Response.json({ ok: true, integration: row });
  } else {
    // Create new row
    const [row] = await db
      .insert(integrations)
      .values({
        id:               generateULID(),
        startupId,
        type,
        connected,
        accessToken:      connected ? accessToken : null,
        scopesJson:       connected ? scopesJson : null,
        connectedAt:      connected ? new Date() : null,
        connectionHealth: "ok",
      })
      .returning();
    return Response.json({ ok: true, integration: row });
  }
}
