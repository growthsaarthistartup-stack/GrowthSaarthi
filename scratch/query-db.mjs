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
        console.log(`Loaded Env Key: ${key}`);
      }
    }
  }
} catch (e) {
  console.warn("Failed to load .env.local", e);
}

// Now dynamic import the client
const { db } = await import("../src/lib/db/client");
const { startups, websiteScans, seoAudits, geoScores } = await import("../src/lib/db/schema");
const { desc, eq } = await import("drizzle-orm");

async function main() {
  const allStartups = await db.select().from(startups);
  console.log("=== STARTUPS ===");
  console.log(JSON.stringify(allStartups, null, 2));

  for (const startup of allStartups) {
    console.log(`\n=== DATA FOR STARTUP: ${startup.name} (${startup.id}) ===`);
    
    const scans = await db.select().from(websiteScans).where(eq(websiteScans.startupId, startup.id)).orderBy(desc(websiteScans.createdAt));
    console.log(`  Scans found: ${scans.length}`);
    if (scans[0]) {
      console.log("  Latest scan detailsJson:", JSON.stringify(JSON.parse(scans[0].detailsJson || "{}"), null, 2).slice(0, 500));
    }

    const audits = await db.select().from(seoAudits).where(eq(seoAudits.startupId, startup.id)).orderBy(desc(seoAudits.createdAt));
    console.log(`  Audits found: ${audits.length}`);
    if (audits[0]) {
      console.log("  Latest audit rawJson:", audits[0].rawJson?.slice(0, 500));
    }

    const geos = await db.select().from(geoScores).where(eq(geoScores.startupId, startup.id)).orderBy(desc(geoScores.createdAt));
    console.log(`  Geos found: ${geos.length}`);
    if (geos[0]) {
      console.log("  Latest geo:", JSON.stringify(geos[0], null, 2));
    }
  }
}

main().catch(console.error);
