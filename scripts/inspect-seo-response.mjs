import "dotenv/config";
const key = process.env.SEO_SCORE_API_KEY;
const res = await fetch(`https://seoscoreapi.com/audit?url=${encodeURIComponent("https://example.com")}`, {
  headers: { "Authorization": `Bearer ${key}`, "x-api-key": key, "Accept": "application/json" },
  signal: AbortSignal.timeout(20000),
});
const data = await res.json();
// Show only the top-level keys and their types/values
for (const [k, v] of Object.entries(data)) {
  if (typeof v !== 'object') {
    console.log(`${k}: ${v}`);
  } else if (Array.isArray(v)) {
    console.log(`${k}: [Array, ${v.length} items, first:`, JSON.stringify(v[0])?.slice(0, 100), "]");
  } else {
    console.log(`${k}: {Object, keys: ${Object.keys(v || {}).join(", ")}, score=${v?.score}}`);
  }
}
