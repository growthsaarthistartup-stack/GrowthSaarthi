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

async function searchSerpApi(query) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const url =
    `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  return data.organic_results ?? [];
}

async function resolveRealUrl(productName) {
  try {
    const results = await searchSerpApi(productName);
    for (const r of results) {
      const url = r.link;
      if (!url) continue;
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (
        host.includes("g2.com") ||
        host.includes("producthunt.com") ||
        host.includes("wikipedia.org") ||
        host.includes("twitter.com") ||
        host.includes("linkedin.com") ||
        host.includes("youtube.com") ||
        host.includes("facebook.com")
      ) {
        continue;
      }
      return `${parsed.protocol}//${host}`;
    }
  } catch (err) {
    console.error(`Error resolving for ${productName}:`, err);
  }
  return null;
}

async function main() {
  console.log("wp engine ->", await resolveRealUrl("wp engine"));
  console.log("rocket net ->", await resolveRealUrl("rocket net"));
}

main().catch(console.error);
