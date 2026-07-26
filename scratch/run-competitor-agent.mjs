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

const { discoverCompetitors } = await import("../src/lib/agents/competitor-agent");
const { db } = await import("../src/lib/db/client");
const { positioningGaps } = await import("../src/lib/db/schema");
const { eq } = await import("drizzle-orm");

async function main() {
  const startupId = "01KYFWEVQ87THPT35FMRM2ZGEV";
  console.log(`Starting competitor discovery for startup ${startupId}...`);
  const result = await discoverCompetitors(startupId);
  console.log("\n--- DISCOVERED COMPETITORS ---");
  console.log(JSON.stringify(result, null, 2));

  const gaps = await db.select().from(positioningGaps).where(eq(positioningGaps.startupId, startupId));
  console.log("\n--- POSITIONING GAPS ---");
  console.log(JSON.stringify(gaps, null, 2));
}

main().catch(console.error);
