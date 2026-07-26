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
const { websiteScans, seoAudits, geoScores } = await import("../src/lib/db/schema");
const { desc, eq } = await import("drizzle-orm");

async function main() {
  const ids = ["01KYETAE1935X577XG3E5S248V", "01KYFWEVQ87THPT35FMRM2ZGEV"];
  for (const id of ids) {
    console.log(`\n=== DATA FOR ${id} ===`);
    const [scan] = await db.select().from(websiteScans).where(eq(websiteScans.startupId, id)).orderBy(desc(websiteScans.createdAt)).limit(1);
    console.log("Scan:", scan ? { id: scan.id, title: scan.title, mobileScore: scan.mobileScore, desktopScore: scan.desktopPerfScore } : null);
    
    const [audit] = await db.select().from(seoAudits).where(eq(seoAudits.startupId, id)).orderBy(desc(seoAudits.createdAt)).limit(1);
    console.log("Audit:", audit ? { id: audit.id, score: audit.score, grade: audit.grade, rawJson: audit.rawJson?.slice(0, 300) } : null);

    const [geo] = await db.select().from(geoScores).where(eq(geoScores.startupId, id)).orderBy(desc(geoScores.createdAt)).limit(1);
    console.log("Geo:", geo ? { id: geo.id, overallGeoScore: geo.overallGeoScore } : null);
  }
}

main().catch(console.error);
