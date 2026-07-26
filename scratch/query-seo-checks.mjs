import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

try {
  const rows = await sql`SELECT raw_json FROM seo_audits ORDER BY created_at DESC LIMIT 1`;
  if (rows.length > 0) {
    const raw = JSON.parse(rows[0].raw_json);
    if (raw.audit) {
      for (const section of Object.keys(raw.audit)) {
        console.log(`\n=== Section: ${section} (Score: ${raw.audit[section].score}) ===`);
        const checks = raw.audit[section].checks || [];
        checks.forEach(c => {
          console.log(` - [${c.status}] ${c.name}: score=${c.score}, value=${JSON.stringify(c.value)?.slice(0, 100)}`);
        });
      }
    }
  }
} catch (e) {
  console.error("Error:", e);
}
