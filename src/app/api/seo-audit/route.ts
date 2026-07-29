/**
 * GET /api/seo-audit
 *
 * Returns the compiled full SEO audit for the authenticated user's startup.
 * Combines: website scan facts + SEOScoreAPI audit cache + GEO score + keywords.
 */

import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { startups, websiteScans, seoAudits, geoScores, keywords } from "@/lib/db/schema";
import { compileFullSeoAudit } from "@/lib/scoring/seo-audit-compiler";
import { requireStartupAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireStartupAuth(request);
  if (auth.error) return auth.error;
  const startupId = auth.startupId!;

  try {
    // 1. Fetch startup (for industry/stage context in the compiler)
    const [startup] = await db
      .select()
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);

    if (!startup) {
      return Response.json({ ok: false, error: "Startup not found" }, { status: 404 });
    }

    // 2. Fetch latest website scan
    const [scan] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.startupId, startupId))
      .orderBy(desc(websiteScans.createdAt))
      .limit(1);

    if (!scan) {
      return Response.json({ ok: false, error: "No website scan found — run a scan first" }, { status: 404 });
    }

    // 3. Fetch latest cached SEOScoreAPI audit
    const [latestAudit] = await db
      .select()
      .from(seoAudits)
      .where(eq(seoAudits.startupId, startupId))
      .orderBy(desc(seoAudits.createdAt))
      .limit(1);

    let auditData: Record<string, unknown> | null = null;
    if (latestAudit?.rawJson) {
      try {
        auditData = JSON.parse(latestAudit.rawJson) as Record<string, unknown>;
      } catch { /* ignore malformed cache */ }
    }

    // 4. Fetch latest GEO score
    const [geo] = await db
      .select()
      .from(geoScores)
      .where(eq(geoScores.startupId, startupId))
      .orderBy(desc(geoScores.createdAt))
      .limit(1);

    // 5. Fetch tracked keywords
    const allKeywords = await db
      .select()
      .from(keywords)
      .where(eq(keywords.startupId, startupId))
      .orderBy(desc(keywords.createdAt))
      .limit(50);

    // 6. Compile the full audit report
    const compiledAudit = compileFullSeoAudit(scan, auditData, geo ?? null, allKeywords, startup);

    return Response.json({ ok: true, audit: compiledAudit });
  } catch (err) {
    console.error("[api/seo-audit] Failed:", err);
    return Response.json({ ok: false, error: "Failed to compile SEO audit" }, { status: 500 });
  }
}
