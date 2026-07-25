/**
 * Full backend connectivity test
 * Run with: node --experimental-vm-modules scripts/e2e-test.mjs
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`  ✅ ${name}${result ? ` → ${result}` : ""}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name} → ${err.message}`);
    failed++;
  }
}

console.log("\n=== GrowthSaarthi Backend E2E Test ===\n");

// 1. Database
console.log("📦 Database (Neon Postgres)");
await test("DATABASE_URL is set", () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return url.slice(0, 30) + "...";
});

await test("Postgres connection test", async () => {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT NOW() as ts`;
  return rows[0].ts;
});

// 2. OpenRouter LLM
console.log("\n🤖 OpenRouter LLM");
await test("OPENROUTER_API_KEY is set", () => {
  const key = process.env.OPENROUTER_API_KEY1 || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("No OPENROUTER_API_KEY found");
  return key.slice(0, 15) + "...";
});

await test("Free model (openrouter/auto) responds", async () => {
  const key = process.env.OPENROUTER_API_KEY1 || process.env.OPENROUTER_API_KEY;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://growthsaarthi.ai",
      "X-Title": "GrowthSaarthi",
    },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: "Reply with exactly the JSON: {\"ok\":true}" },
        { role: "user",   content: "Ping" },
      ],
      response_format: { type: "json_object" },
      max_tokens: 20,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Status ${res.status}: ${JSON.stringify(data)}`);
  const content = data.choices?.[0]?.message?.content;
  return `model=${data.model?.slice(0, 30)}, content=${content}`;
});

// 3. SEOScoreAPI
console.log("\n📊 SEOScoreAPI");
await test("SEO_SCORE_API_KEY is set", () => {
  const key = process.env.SEO_SCORE_API_KEY;
  if (!key) throw new Error("SEO_SCORE_API_KEY not set");
  return key.slice(0, 20) + "...";
});

await test("SEOScoreAPI returns audit for example.com", async () => {
  const key = process.env.SEO_SCORE_API_KEY;
  const res = await fetch(`https://seoscoreapi.com/audit?url=${encodeURIComponent("https://example.com")}`, {
    headers: { "Authorization": `Bearer ${key}`, "x-api-key": key, "Accept": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return `score=${data.score}, grade=${data.grade}`;
});

// 4. SerpAPI
console.log("\n🔍 SerpAPI");
await test("SERPAPI_KEY is set", () => {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not set");
  return key.slice(0, 15) + "...";
});

await test("SerpAPI search returns results", async () => {
  const key = process.env.SERPAPI_KEY;
  const url = `https://serpapi.com/search.json?engine=google&q=saas+tools&api_key=${key}&num=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Status ${res.status}`);
  const data = await res.json();
  const count = data.organic_results?.length ?? 0;
  return `${count} results`;
});

// 5. Resend (email)
console.log("\n📧 Resend Email");
await test("RESEND_API_KEY is set", () => {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  return key.slice(0, 15) + "...";
});

await test("Resend API key is valid", async () => {
  const key = process.env.RESEND_API_KEY;
  const res = await fetch("https://api.resend.com/domains", {
    headers: { "Authorization": `Bearer ${key}` },
  });
  if (res.status === 401) throw new Error("Invalid API key (401)");
  if (res.status === 403) throw new Error("Forbidden (403)");
  return `status=${res.status}`;
});

// 6. DB Tables
console.log("\n🗄️  Database Tables");
const tables = ["startups", "competitors", "website_scans", "keywords", "recommendations", "content_drafts", "integrations", "feedback_signals"];
for (const table of tables) {
  await test(`Table "${table}" exists`, async () => {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = ${table} AND table_schema = 'public'`;
    if (rows[0].cnt === "0") throw new Error(`Table "${table}" not found in DB`);
    const count = await sql.query(`SELECT COUNT(*) as cnt FROM ${table}`);
    return `${count[0].cnt} rows`;
  });
}

// Summary
console.log(`\n${"=".repeat(40)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\n⚠️  Some tests failed. Fix the issues above before proceeding.");
  process.exit(1);
} else {
  console.log("\n✅ All systems fully connected and operational!");
}
