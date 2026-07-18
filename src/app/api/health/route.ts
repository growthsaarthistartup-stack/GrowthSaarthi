/**
 * GET /api/health
 *
 * Returns the lib skeleton status — useful for verifying the backend
 * wiring before adding real agent routes.
 */

import { MODEL_ROUTES } from "@/lib/models";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

export async function GET() {
  return Response.json({
    status: "ok",
    modelRoutes: Object.keys(MODEL_ROUTES).length,
    sampleIdempotencyKey: buildIdempotencyKey("WebsiteScan", "startup_123", "playwright", todayWindow()),
    dbConfigured: !!process.env.DATABASE_URL,
    openRouterConfigured: !!process.env.OPENROUTER_API_KEY,
  });
}
