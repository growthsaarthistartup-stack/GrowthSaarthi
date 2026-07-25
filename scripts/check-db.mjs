import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// List all tables
const rows = await sql`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name
`;

console.log(`\n📋 Tables in Neon DB (${rows.length} total):`);
rows.forEach(r => console.log("  ✅", r.table_name));

// Expected tables
const expected = [
  "startups", "competitors", "website_scans", "keywords",
  "recommendations", "content_drafts", "integrations",
  "feedback_signals", "otps", "brand_voices", "metrics",
  "telemetry_events", "agent_failures"
];

console.log("\n📊 Row counts:");
for (const t of expected) {
  const exists = rows.find(r => r.table_name === t);
  if (exists) {
    try {
      const r = await sql`SELECT COUNT(*)::int as cnt FROM startups`;
      const cnt = await sql.query(`SELECT COUNT(*)::int as cnt FROM ${t}`);
      console.log(`  ✅ ${t}: ${cnt[0].cnt} rows`);
    } catch(e) {
      console.log(`  ⚠️  ${t}: exists but count failed: ${e.message.slice(0,50)}`);
    }
  } else {
    console.log(`  ❌ ${t}: NOT IN DB — migration needed`);
  }
}
