/**
 * Competitor Discovery Agent
 *
 * Flow (spec §3.4):
 *   1. Check weekly idempotency — one SerpApi search per startup per week max.
 *   2. SerpApi free-tier search: "best {industry} tools site:g2.com OR site:producthunt.com"
 *   3. Extract product names + URLs with regex/string parsing — NO LLM.
 *   4. Scrape each candidate site with fetch+cheerio (lightweight, not Playwright).
 *   5. Embed hero copy with @xenova/transformers (local, no API cost).
 *   6. Cosine similarity >= THRESHOLD (0.72) → candidate is a real competitor.
 *   7. Only the positioning-gap writeup goes through runAgent() (competitor_gap_analysis).
 *   8. Write Competitor facts for confirmed matches.
 *   9. On ANY error: writeAgentFailure, return null.
 */

import * as cheerio from "cheerio";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { competitors, startups } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, isoWeekWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";
import { runAgent, type AgentContract } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";

// ---------------------------------------------------------------------------
// Threshold (spec §3.4) — hardcoded; calibration pipeline is a v2 script
// ---------------------------------------------------------------------------

const COMPETITOR_SIMILARITY_THRESHOLD = 0.72;

// ---------------------------------------------------------------------------
// Local embeddings — @xenova/transformers, no API cost
// ---------------------------------------------------------------------------

type EmbedderPipeline = {
  (text: string, opts: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array }>;
};

let _embedder: EmbedderPipeline | null = null;

async function getEmbedder(): Promise<EmbedderPipeline> {
  if (_embedder) return _embedder;
  // Dynamic import keeps the large model loader out of the initial bundle
  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = "./.cache/transformers";
  _embedder = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")) as unknown as EmbedderPipeline;
  return _embedder;
}

async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const out = await model(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// SerpApi call — one search per startup per week via idempotency
// ---------------------------------------------------------------------------

interface SerpResult {
  title?: string;
  link?: string;
  snippet?: string;
}

async function searchSerpApi(query: string): Promise<SerpResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const url =
    `https://serpapi.com/search.json` +
    `?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}&num=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SerpApi ${res.status}: ${txt}`);
  }
  const data = (await res.json()) as { organic_results?: SerpResult[] };
  return data.organic_results ?? [];
}

// ---------------------------------------------------------------------------
// Candidate extraction — regex/string parsing, no LLM (spec §3.4 step 2)
// ---------------------------------------------------------------------------

interface Candidate {
  name: string;
  url:  string;
}

function extractCandidates(results: SerpResult[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const r of results) {
    const link  = r.link  ?? "";
    const title = r.title ?? "";

    // G2: g2.com/products/{slug}/...
    const g2 = link.match(/g2\.com\/products\/([^/?#]+)/);
    if (g2) {
      const slug = g2[1];
      const prodUrl = `https://www.${slug}.com`;
      if (!seen.has(prodUrl)) { seen.add(prodUrl); out.push({ name: slug.replace(/-/g, " "), url: prodUrl }); }
      continue;
    }

    // ProductHunt: producthunt.com/products/{slug}
    const ph = link.match(/producthunt\.com\/products\/([^/?#]+)/);
    if (ph) {
      const slug = ph[1];
      const prodUrl = `https://www.${slug}.com`;
      if (!seen.has(prodUrl)) { seen.add(prodUrl); out.push({ name: slug.replace(/-/g, " "), url: prodUrl }); }
      continue;
    }

    // Generic: use domain from URL + first segment of title as name
    try {
      const domain   = new URL(link).hostname.replace(/^www\./, "");
      const prodUrl  = `https://${new URL(link).hostname}`;
      const name     = title.split(/[-|–—]/)[0].trim();
      if (domain && name && !seen.has(prodUrl)) {
        seen.add(prodUrl);
        out.push({ name, url: prodUrl });
      }
    } catch { /* malformed URL — skip */ }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Lightweight competitor site scrape (fetch + cheerio, not Playwright)
// ---------------------------------------------------------------------------

async function scrapeCompetitorSite(
  url: string,
): Promise<{ heroCopy: string; positioningAngle: string; pricingModel: string | null; features: string[] } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $    = cheerio.load(html);

    const heroCopy = (
      $("[class*='hero'], [id*='hero'], main, [role='main']").first().text() ||
      $("body").text()
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);

    const positioningAngle = $("h1").first().text().replace(/\s+/g, " ").trim().slice(0, 200);

    // Pricing clue — look for pricing page link or section
    const hasPricingPage = $("a[href*='pric']").length > 0;
    const pricingSection = $("[class*='pric'], [id*='pric']").text().trim().slice(0, 300);
    const pricingModel   = hasPricingPage || pricingSection
      ? (pricingSection || "See pricing page").slice(0, 300)
      : null;

    // Feature list — common markup patterns
    const features: string[] = [];
    $("[class*='feature'] h3, [class*='feature'] h4, [class*='featur'] li").each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 100) features.push(t);
    });

    return { heroCopy, positioningAngle, pricingModel, features: [...new Set(features)].slice(0, 20) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Positioning-gap analysis — the ONE step that uses runAgent() (spec §3.4)
// ---------------------------------------------------------------------------

const PositioningGapSchema = z.object({
  gaps:          z.array(z.string()),
  opportunities: z.array(z.string()),
});

const POSITIONING_GAP_AGENT: AgentContract<typeof PositioningGapSchema> = {
  name:         "positioning_gap_agent",
  model:        MODEL_ROUTES.competitor_gap_analysis[0],
  fallbackModel: MODEL_ROUTES.competitor_gap_analysis[1],
  systemPrompt:
    "You are a competitive strategy expert. Given a startup's hero copy and a list of " +
    "confirmed competitors with their positioning, identify specific positioning gaps " +
    "(angles the startup is missing) and concrete opportunities to differentiate. " +
    "Be specific — reference actual copy from both sides. Output as JSON.",
  outputSchema: PositioningGapSchema,
  maxRetries:   2,
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type CompetitorRow = typeof competitors.$inferSelect;

export async function discoverCompetitors(startupId: string): Promise<CompetitorRow[] | null> {
  const weekKey = buildIdempotencyKey("CompetitorScan", startupId, "serpapi", isoWeekWindow());

  try {
    // Load startup for context
    const [startup] = await db
      .select()
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);
    if (!startup) throw new Error(`Startup ${startupId} not found`);

    // Weekly cache check — already ran this week?
    const alreadyThisWeek = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(and(eq(competitors.startupId, startupId), eq(competitors.idempotencyKey, weekKey)))
      .limit(1);
    if (alreadyThisWeek.length > 0) {
      // Return all competitors found this week
      return db.select().from(competitors).where(eq(competitors.startupId, startupId));
    }

    // SerpApi search
    const query = `best ${startup.industry ?? "SaaS"} tools site:g2.com OR site:producthunt.com`;
    const serpResults = await searchSerpApi(query);
    const candidates  = extractCandidates(serpResults).slice(0, 10); // cap to 10 candidates

    // Embed the startup's own value proposition
    const startupText = [startup.name, startup.industry].filter(Boolean).join(" — ");
    const startupVec  = await embed(startupText);

    const confirmedCompetitors: CompetitorRow[] = [];

    for (const candidate of candidates) {
      const site = await scrapeCompetitorSite(candidate.url);
      if (!site || !site.heroCopy) continue;

      const candidateVec = await embed(site.heroCopy);
      const similarity   = cosineSimilarity(startupVec, candidateVec);

      if (similarity < COMPETITOR_SIMILARITY_THRESHOLD) continue;

      // Confirmed competitor — write fact
      const [comp] = await db
        .insert(competitors)
        .values({
          id:               generateULID(),
          startupId,
          idempotencyKey:   weekKey + ":" + candidate.url,
          name:             candidate.name,
          url:              candidate.url,
          heroCopy:         site.heroCopy,
          positioningAngle: site.positioningAngle,
          pricingModel:     site.pricingModel,
          features:         site.features,
        })
        .onConflictDoNothing()
        .returning();

      if (comp) confirmedCompetitors.push(comp);
    }

    // Positioning-gap analysis through runAgent() if we found any competitors
    if (confirmedCompetitors.length > 0) {
      try {
        await runAgent(POSITIONING_GAP_AGENT, {
          startupName:      startup.name,
          startupIndustry:  startup.industry,
          startupHeroCopy:  startupText,
          competitors:      confirmedCompetitors.map((c) => ({
            name:       c.name,
            heroCopy:   c.heroCopy,
            positioning: c.positioningAngle,
          })),
        });
        // Gap result is returned but we don't store it as a separate entity yet (Phase 3)
      } catch (gapErr) {
        await writeAgentFailure(startupId, "positioning_gap_agent", gapErr);
      }
    }

    return confirmedCompetitors;
  } catch (err) {
    await writeAgentFailure(startupId, "competitor_agent", err);
    return null;
  }
}
