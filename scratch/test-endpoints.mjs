import fs from "fs";
import path from "path";

// Load .env.local manually
try {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn("Failed to load .env.local", e);
}

const { db } = await import("../src/lib/db/client");
const { startups, websiteScans, seoAudits, geoScores, keywords } = await import("../src/lib/db/schema");
const { desc, eq } = await import("drizzle-orm");
const { compileFullSeoAudit } = await import("../src/lib/scoring/seo-audit-compiler");

async function testStartup(startupId) {
  const [startup] = await db.select().from(startups).where(eq(startups.id, startupId)).limit(1);
  if (!startup) {
    console.log(`Startup ${startupId} not found`);
    return;
  }

  const [scan] = await db
    .select().from(websiteScans)
    .where(eq(websiteScans.startupId, startupId))
    .orderBy(desc(websiteScans.createdAt)).limit(1);

  const [latestAudit] = await db
    .select().from(seoAudits)
    .where(eq(seoAudits.startupId, startupId))
    .orderBy(desc(seoAudits.createdAt)).limit(1);

  let auditData = null;
  if (latestAudit?.rawJson) {
    try { auditData = JSON.parse(latestAudit.rawJson); } catch {}
  }

  const [geo] = await db
    .select().from(geoScores)
    .where(eq(geoScores.startupId, startupId))
    .orderBy(desc(geoScores.createdAt)).limit(1);

  const allKeywords = await db
    .select().from(keywords)
    .where(eq(keywords.startupId, startupId))
    .orderBy(desc(keywords.createdAt)).limit(50);

  // Compile using auditData (like /api/seo-audit)
  const compiledAudit = compileFullSeoAudit(scan, auditData, geo, allKeywords, startup);

  // Compile using latestAudit (like /api/seo-report)
  const compiledReport = compileFullSeoAudit(scan, latestAudit, geo, allKeywords, startup);

  console.log(`\n=== RESULTS FOR STARTUP ${startup.name} (${startupId}) ===`);
  console.log("Using auditData (/api/seo-audit):");
  console.log(`  Overall: ${compiledAudit.overallScore} (${compiledAudit.overallGrade})`);
  console.log(`  On-Page: ${compiledAudit.scores.onPage}`);
  console.log(`  Performance: ${compiledAudit.scores.performance}`);
  console.log(`  GEO: ${compiledAudit.scores.geo}`);
  console.log(`  Usability: ${compiledAudit.scores.usability}`);

  console.log("Using latestAudit (/api/seo-report):");
  console.log(`  Overall: ${compiledReport.overallScore} (${compiledReport.overallGrade})`);
  console.log(`  On-Page: ${compiledReport.scores.onPage}`);
  console.log(`  Performance: ${compiledReport.scores.performance}`);
  console.log(`  GEO: ${compiledReport.scores.geo}`);
  console.log(`  Usability: ${compiledReport.scores.usability}`);
}

async function main() {
  await testStartup("01KYETAE1935X577XG3E5S248V");
  await testStartup("01KYFWEVQ87THPT35FMRM2ZGEV");
}

main().catch(console.error);
