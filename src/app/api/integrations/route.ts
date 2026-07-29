/**
 * GET /api/integrations     — list integrations for the authenticated user's startup
 * POST /api/integrations    — create or update an integration
 *
 * NOTE on access token security: tokens are stored encrypted at the DB level
 * via Neon's column-level encryption (or should be — see INT-SEC-4 in audit).
 * The accessToken field is never returned in GET responses.
 */

import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { integrations } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    const rows = await db
      .select({
        id:               integrations.id,
        startupId:        integrations.startupId,
        type:             integrations.type,
        connected:        integrations.connected,
        connectedAt:      integrations.connectedAt,
        connectionHealth: integrations.connectionHealth,
        scopesJson:       integrations.scopesJson,
        updatedAt:        integrations.updatedAt,
        // accessToken intentionally excluded from GET response
      })
      .from(integrations)
      .where(eq(integrations.startupId, startupId));

    return Response.json({ ok: true, integrations: rows });
  } catch (err) {
    console.error("[api/integrations] GET error:", err);
    return Response.json({ error: "Failed to fetch integrations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  let body: {
    type?: "linkedin" | "youtube" | "facebook" | "instagram" | "twitter" | "ga4" | "gsc" | "stripe" | "posthog" | "hubspot" | "github" | "clarity";
    connected?: boolean;
    accessToken?: string;
    scopesJson?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, connected = false, accessToken = "", scopesJson = "{}" } = body;
  if (!type) {
    return Response.json({ error: "type is required" }, { status: 400 });
  }

  try {
    // Find existing integration row for this startup + type
    const [existing] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.startupId, startupId), eq(integrations.type, type)))
      .limit(1);

    if (existing) {
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
      // Don't return accessToken
      const { accessToken: _tok, ...safe } = row as typeof row & { accessToken: unknown };
      return Response.json({ ok: true, integration: safe });
    } else {
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
      const { accessToken: _tok, ...safe } = row as typeof row & { accessToken: unknown };
      return Response.json({ ok: true, integration: safe });
    }
  } catch (err) {
    console.error("[api/integrations] POST error:", err);
    return Response.json({ error: "Failed to save integration" }, { status: 500 });
  }
}
