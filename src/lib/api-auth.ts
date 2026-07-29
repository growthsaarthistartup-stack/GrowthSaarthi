/**
 * src/lib/api-auth.ts
 *
 * Route-level auth guard — import requireAuth() in any API route handler.
 *
 * Usage:
 *   const authResult = await requireAuth(request);
 *   if (authResult.error) return authResult.error;
 *   const { user, startupId } = authResult;
 *
 * Design:
 *   - Validates the session cookie via getSession() (DB-backed, expiry-checked).
 *   - Looks up the startup that belongs to this user.
 *   - Returns a typed discriminated union so callers get both the user AND their
 *     startupId in a single call with zero boilerplate.
 *   - The `startupId` returned here is the ONLY one callers should trust.
 *     Never accept startupId from query params or request body — that is IDOR.
 */

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { startups } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";

export type AuthSuccess = {
  error: null;
  user: { id: string; email: string };
  startupId: string | null; // null for users who haven't completed onboarding
};

export type AuthFailure = {
  error: Response;
  user?: never;
  startupId?: never;
};

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * requireAuth — verify the session and resolve the user's startup.
 *
 * @param _request  The incoming NextRequest (kept for future IP-based rate limiting).
 * @param options.requireStartup  If true, returns 403 when the user has no startup yet.
 */
export async function requireAuth(
  _request: NextRequest,
  options: { requireStartup?: boolean } = {},
): Promise<AuthResult> {
  // 1. Validate session
  let user: { id: string; email: string } | null = null;
  try {
    user = await getSession();
  } catch {
    return {
      error: Response.json(
        { error: "Authentication service unavailable" },
        { status: 503 },
      ),
    };
  }

  if (!user) {
    return {
      error: Response.json(
        { error: "Unauthenticated — please sign in" },
        { status: 401 },
      ),
    };
  }

  // 2. Resolve the startup that belongs to this user
  let startupId: string | null = null;
  try {
    const [startup] = await db
      .select({ id: startups.id })
      .from(startups)
      .where(eq(startups.userId, user.id))
      .limit(1);
    startupId = startup?.id ?? null;
  } catch {
    return {
      error: Response.json(
        { error: "Failed to resolve startup" },
        { status: 500 },
      ),
    };
  }

  if (options.requireStartup && !startupId) {
    return {
      error: Response.json(
        { error: "No startup found — complete onboarding first" },
        { status: 403 },
      ),
    };
  }

  return { error: null, user, startupId };
}

/**
 * requireStartupAuth — shorthand for requireAuth with requireStartup: true.
 * Use this in all routes that need both a valid session AND a startup.
 */
export async function requireStartupAuth(
  request: NextRequest,
): Promise<AuthResult> {
  return requireAuth(request, { requireStartup: true });
}
