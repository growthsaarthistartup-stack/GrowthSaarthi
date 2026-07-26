import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

try {
  const rows = await sql`SELECT id, score, grade, raw_json FROM seo_audits ORDER BY created_at DESC LIMIT 1`;
  if (rows.length === 0) {
    console.log("No SEO audits found in the database.");
  } else {
    console.log(`Found SEO Audit with ID: ${rows[0].id}, Score: ${rows[0].score}, Grade: ${rows[0].grade}`);
    const raw = JSON.parse(rows[0].raw_json);
    console.log("Keys in rawJson:", Object.keys(raw));
    if (raw.audit) {
      console.log("Audit sections:", Object.keys(raw.audit));
      for (const section of Object.keys(raw.audit)) {
        console.log(`- ${section}:`, Object.keys(raw.audit[section]));
      }
    }
  }
} catch (e) {
  console.error("Error running query:", e);
}
