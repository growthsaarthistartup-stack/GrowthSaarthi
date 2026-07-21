/**
 * GET /api/seo-audit?url=https://example.com
 * Proxies a request to SEOScoreAPI and returns the structured audit result.
 * Used by the SEO Analysis tab in the dashboard.
 */

import type { NextRequest } from "next/server";
import { fetchSeoScoreAudit } from "@/lib/integrations/seo-score-api";

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  const audit = await fetchSeoScoreAudit(url);

  if (!audit) {
    return Response.json({ ok: false, error: "SEO audit unavailable for this URL" }, { status: 200 });
  }

  return Response.json({ ok: true, audit });
}
