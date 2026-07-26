import type { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { startups, websiteScans, seoAudits, geoScores, keywords } from "@/lib/db/schema";
import { compileFullSeoAudit } from "@/lib/scoring/seo-audit-compiler";

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl.searchParams.get("url");
  const startupIdParam = request.nextUrl.searchParams.get("startupId");

  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  try {
    // 1. Resolve startup
    let startup: any = null;
    if (startupIdParam) {
      [startup] = await db.select().from(startups).where(eq(startups.id, startupIdParam)).limit(1);
    } else {
      [startup] = await db.select().from(startups).where(eq(startups.url, url)).limit(1);
    }

    if (!startup) {
      return Response.json({ ok: false, error: "Startup not found for this URL" });
    }

    const startupId = startup.id;

    // 2. Fetch latest website scan
    const [scan] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.startupId, startupId))
      .orderBy(desc(websiteScans.createdAt))
      .limit(1);

    if (!scan) {
      return Response.json({ ok: false, error: "Website scan not found for this startup" });
    }

    // 3. Fetch latest cached audit
    const [latestAudit] = await db
      .select()
      .from(seoAudits)
      .where(eq(seoAudits.startupId, startupId))
      .orderBy(desc(seoAudits.createdAt))
      .limit(1);

    let auditData: any = null;
    if (latestAudit?.rawJson) {
      try {
        auditData = JSON.parse(latestAudit.rawJson);
      } catch { /* ignore */ }
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

    // 6. Compile
    const compiledAudit = compileFullSeoAudit(scan, auditData, geo, allKeywords, startup);

    return Response.json({ ok: true, audit: compiledAudit });
  } catch (err: any) {
    console.error("[api/seo-audit] Failed:", err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
