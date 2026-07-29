/**
 * Competitor Discovery Agent
 *
 * Flow:
 *   1. Check weekly idempotency — one SerpApi search per startup per week max.
 *   2. Load the startup website scan and extract its profile (industry/niche, services, pricing clues) using STARTUP_PROFILE_AGENT.
 *   3. Update startup row with the auto-extracted industry for consistent analysis.
 *   4. Run targeted SerpApi searches: "best {industry} tools", "{startupName} alternative", "{services[0]} competitors".
 *   5. Scrape each competitor's homepage and extract rich comparison details (features, pricing tiers, positioning) via COMPETITOR_EXTRACTOR_AGENT.
 *   6. Compute local miniLM embeddings and compare similarity.
 *   7. Run POSITIONING_GAP_AGENT to find strategic differentiation opportunities and write positioning gaps.
 */

import * as cheerio from "cheerio";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { competitors, startups, positioningGaps, websiteScans } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, isoWeekWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";
import { runAgent, type AgentContract } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";
import { THIN_PAGE_WORD_THRESHOLD } from "@/lib/scoring/seo-audit-compiler";

// ---------------------------------------------------------------------------
// Dynamic similarity threshold
// ---------------------------------------------------------------------------

export function medianSimilarity(scores: number[]): number {
  if (scores.length === 0) return 0.72;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeDynamicThreshold(scores: number[]): number {
  return Math.max(0.6, medianSimilarity(scores));
}

// ---------------------------------------------------------------------------
// Local embeddings — @xenova/transformers
// ---------------------------------------------------------------------------

type EmbedderPipeline = {
  (text: string, opts: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array }>;
};

let _embedder: EmbedderPipeline | null = null;

async function getEmbedder(): Promise<EmbedderPipeline> {
  if (_embedder) return _embedder;
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
// SerpApi call
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
// Candidate extraction
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

    const g2 = link.match(/g2\.com\/products\/([^/?#]+)/);
    if (g2) {
      const slug = g2[1];
      const prodUrl = `https://www.${slug}.com`;
      if (!seen.has(prodUrl)) { seen.add(prodUrl); out.push({ name: slug.replace(/-/g, " "), url: prodUrl }); }
      continue;
    }

    const ph = link.match(/producthunt\.com\/products\/([^/?#]+)/);
    if (ph) {
      const slug = ph[1];
      const prodUrl = `https://www.${slug}.com`;
      if (!seen.has(prodUrl)) { seen.add(prodUrl); out.push({ name: slug.replace(/-/g, " "), url: prodUrl }); }
      continue;
    }

    try {
      const domain = new URL(link).hostname.replace(/^www\./, "");
      const prodUrl = `https://${new URL(link).hostname}`;
      const name = title.split(/[-|–—]/)[0].trim();
      if (domain && name && !seen.has(prodUrl)) {
        seen.add(prodUrl);
        out.push({ name, url: prodUrl });
      }
    } catch { /* skip */ }
  }

  return out;
}

// ---------------------------------------------------------------------------
// BUG-1+2 FIX: Resolve real vendor URL from G2 or ProductHunt review page
// instead of blindly constructing https://www.{slug}.com (which is often wrong)
// ---------------------------------------------------------------------------

/**
 * Single consolidated noise domain list used throughout this file.
 * Both the SerpAPI result filter and the URL resolver reference this same Set,
 * ensuring consistent filtering without two separate lists that can drift apart.
 */
const NOISE_HOSTS = new Set([
  // Social networks & communities
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "reddit.com", "quora.com", "youtube.com",
  // Reference & encyclopaedia
  "wikipedia.org", "medium.com",
  // Review aggregators (we resolve actual vendor URLs from these, but never treat them as the vendor)
  "g2.com", "producthunt.com", "capterra.com", "getapp.com", "softwareadvice.com", "trustpilot.com",
  // Job boards & HR
  "ziprecruiter.com", "glassdoor.com", "indeed.com",
  // Business intelligence
  "cbinsights.com", "crunchbase.com", "muckrack.com",
]);


async function resolveVendorUrlFromReviewPage(reviewPageUrl: string, productName: string): Promise<string | null> {
  // First: try to extract vendor URL from the review page HTML (e.g. G2 "Visit Website" link)
  try {
    const res = await fetch(reviewPageUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
    });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      // G2 pattern: data-track link, og:url, or canonical
      const ogUrl = $("meta[property='og:url']").attr("content");
      if (ogUrl) {
        try {
          const parsed = new URL(ogUrl);
          if (!NOISE_HOSTS.has(parsed.hostname.replace(/^www\./, ""))) {
            return `${parsed.protocol}//${parsed.hostname}`;
          }
        } catch { /* ignore */ }
      }

      // Look for external link labelled "Visit Website" or href with vendor domain
      let foundUrl: string | null = null;
      $("a[href]").each((_, el) => {
        if (foundUrl) return;
        const href = $(el).attr("href") ?? "";
        const text = $(el).text().toLowerCase();
        if (text.includes("visit website") || text.includes("official site") || text.includes("website")) {
          try {
            const parsed = new URL(href);
            if (!NOISE_HOSTS.has(parsed.hostname.replace(/^www\./, ""))) {
              foundUrl = `${parsed.protocol}//${parsed.hostname}`;
            }
          } catch { /* ignore */ }
        }
      });
      if (foundUrl) return foundUrl;
    }
  } catch { /* fall through to SerpAPI backup */ }

  // Fallback: single SerpAPI call using product name (not per-candidate, shared)
  try {
    const results = await searchSerpApi(`${productName} official site`);
    for (const r of results) {
      if (!r.link) continue;
      try {
        const parsed = new URL(r.link);
        const host = parsed.hostname.replace(/^www\./, "");
        if (!NOISE_HOSTS.has(host)) return `${parsed.protocol}//${parsed.hostname}`;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return null;
}

// ---------------------------------------------------------------------------
// Multi-page competitor scraper
// Scrapes homepage + /pricing + /features + /about for richer intelligence
// ---------------------------------------------------------------------------

async function scrapeCompetitorMultiPage(baseUrl: string): Promise<string | null> {
  const HIGH_VALUE_PATHS = ["", "/pricing", "/features", "/about", "/product"];

  const pageTexts = await Promise.allSettled(
    HIGH_VALUE_PATHS.map(async (path) => {
      const url = `${baseUrl.replace(/\/$/, "")}${path}`;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
        });
        if (!res.ok) return null;
        const html = await res.text();
        const $ = cheerio.load(html);

        const texts: string[] = [];
        if (path === "") {
          // Homepage: headings + first 10 paragraphs
          $("h1, h2, h3").each((_, el) => { texts.push($(el).text().trim()); });
          $("p").slice(0, 10).each((_, el) => { texts.push($(el).text().trim()); });
        } else if (path === "/pricing") {
          // Pricing page: emphasis on price values, plan names, feature lists
          $("h1, h2, h3, [class*='plan'], [class*='price'], [class*='tier']").each((_, el) => {
            texts.push($(el).text().trim());
          });
          $("li, p").slice(0, 20).each((_, el) => { texts.push($(el).text().trim()); });
        } else {
          // Features/About: all headings + first 15 list items
          $("h1, h2, h3").each((_, el) => { texts.push($(el).text().trim()); });
          $("li").slice(0, 15).each((_, el) => { texts.push($(el).text().trim()); });
          $("p").slice(0, 8).each((_, el) => { texts.push($(el).text().trim()); });
        }

        return texts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      } catch {
        return null;
      }
    }),
  );

  const combined = pageTexts
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled" && !!r.value)
    .map(r => r.value as string)
    .join(" | ");

  return combined.slice(0, 3000) || null;
}


// ---------------------------------------------------------------------------
// AI Agents definition
// ---------------------------------------------------------------------------

const StartupProfileSchema = z.object({
  industry: z.string(),
  services: z.array(z.string()),
  pricingClues: z.string(),
});

const STARTUP_PROFILE_AGENT: AgentContract<typeof StartupProfileSchema> = {
  name: "startup_profile_agent",
  model: MODEL_ROUTES.competitor_gap_analysis[0],
  fallbackModel: MODEL_ROUTES.competitor_gap_analysis[1],
  systemPrompt:
    "You are a startup analysis expert. Given the scraped text of a startup's website, " +
    "extract its industry/niche, core services/products, and any pricing clues (e.g. starting price, " +
    "free tier, subscription, or 'Contact Sales'). Keep the industry/niche short (1-3 words, " +
    "e.g. 'WordPress Hosting' or 'B2B Sales CRM'). Output as JSON.",
  outputSchema: StartupProfileSchema,
  maxRetries: 2,
};

const CompetitorExtractorSchema = z.object({
  positioningAngle: z.string(),
  pricingModel: z.string().nullable(),
  pricingTiers: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
});

const COMPETITOR_EXTRACTOR_AGENT: AgentContract<typeof CompetitorExtractorSchema> = {
  name: "competitor_extractor_agent",
  model: MODEL_ROUTES.competitor_gap_analysis[0],
  fallbackModel: MODEL_ROUTES.competitor_gap_analysis[1],
  systemPrompt:
    "You are a competitive intelligence bot. Given the scraped homepage text of a competitor website, " +
    "extract their core positioning angle (short summary of value proposition), starting pricing model " +
    "(e.g. '$10/mo', 'Free tier', or null if unknown), a list of pricing tiers if found, and a list of " +
    "key features (up to 6 items). Output as JSON.",
  outputSchema: CompetitorExtractorSchema,
  maxRetries: 2,
};

const PositioningGapSchema = z.object({
  gaps: z.array(z.object({
    gapDescription: z.string(),
    opportunity:    z.string().optional(),
    confidence:     z.number().min(0).max(1).optional(),
  })),
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
    // 1. Load startup context
    const [startup] = await db
      .select()
      .from(startups)
      .where(eq(startups.id, startupId))
      .limit(1);
    if (!startup) throw new Error(`Startup ${startupId} not found`);

    // Weekly cache check
    const alreadyThisWeek = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(and(eq(competitors.startupId, startupId), eq(competitors.idempotencyKey, weekKey)))
      .limit(1);
    if (alreadyThisWeek.length > 0) {
      return db.select().from(competitors).where(eq(competitors.startupId, startupId));
    }

    // 2. Load latest website scan to extract profile
    const [scan] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.startupId, startupId))
      .orderBy(desc(websiteScans.createdAt))
      .limit(1);

    let extractedProfile = {
      industry: startup.industry || "startup",
      services: [] as string[],
      pricingClues: "Contact Sales",
    };

    if (scan) {
      const scanText = [
        scan.title ?? "",
        scan.metaDescription ?? "",
        scan.h1 ?? "",
        scan.heroCopy ?? "",
      ].filter(Boolean).join("\n");

      if (scanText.trim().length > 50) {
        try {
          const profileResult = await runAgent(STARTUP_PROFILE_AGENT, {
            startupName: startup.name,
            websiteUrl: startup.url,
            scanText: scanText.slice(0, 2000),
          });
          if (profileResult) {
            extractedProfile = {
              industry: profileResult.industry || startup.industry || "startup",
              services: profileResult.services || [],
              pricingClues: profileResult.pricingClues || "Contact Sales",
            };

            // Update database startups row with extracted industry
            await db
              .update(startups)
              .set({ industry: extractedProfile.industry, updatedAt: new Date() })
              .where(eq(startups.id, startupId));
          }
        } catch (err) {
          console.warn("[competitor-agent] Failed to auto-extract profile with LLM:", err);
        }
      }
    }

    // 3. Build targeted SerpApi search queries
    const industryLabel = extractedProfile.industry;
    // Derive the brand domain name (e.g. "dronahost.com") for the alternative query
    let brandDomain = "";
    try {
      brandDomain = startup.url ? new URL(startup.url).hostname.replace(/^www\./, "") : "";
    } catch { /* ignore */ }
    const brandForQuery = brandDomain || startup.name;

    const queries = [
      `best ${industryLabel} tools site:g2.com OR site:producthunt.com`,
      `${brandForQuery} alternative`,
      `${extractedProfile.services[0] || industryLabel} providers`,
      `top ${industryLabel} companies`,
    ];

    console.info(`[competitor-agent] Running targeted search queries for ${brandForQuery}:`, queries);

    const serpResultSets = await Promise.allSettled(queries.map(q => searchSerpApi(q)));
    const allSerpResults = serpResultSets
      .filter((r): r is PromiseFulfilledResult<SerpResult[]> => r.status === "fulfilled")
      .flatMap(r => r.value);

    const seenLinks = new Set<string>();
    const dedupedResults = allSerpResults.filter(r => {
      if (!r.link || seenLinks.has(r.link)) return false;
      seenLinks.add(r.link);
      return true;
    });

    // Filter noise domains before candidate extraction using the shared NOISE_HOSTS set
    const cleanResults = dedupedResults.filter(r => {
      if (!r.link) return false;
      try {
        const host = new URL(r.link).hostname.replace(/^www\./, "");
        return !NOISE_HOSTS.has(host) && !Array.from(NOISE_HOSTS).some(n => host.endsWith(`.${n}`));
      } catch { return false; }
    });

    const candidates = extractCandidates(cleanResults).slice(0, 20);

    // BUG-3 FIX: Embed startup using same content depth as competitor scrape
    // Previously only embedded "name + industry" (3 tokens) vs competitor's 1000-char paragraphs.
    // Now uses title + h1 + heroCopy + industry + services for a semantically equivalent vector.
    const startupText = [
      startup.name,
      extractedProfile.industry,
      ...extractedProfile.services,
      scan?.title ?? "",
      scan?.h1 ?? "",
      (scan?.heroCopy ?? "").slice(0, 300),
    ].filter(Boolean).join(" ");
    const startupVec  = await embed(startupText.slice(0, 1000));

    const candidateSims: Array<{
      candidate: Candidate;
      extracted: z.infer<typeof CompetitorExtractorSchema>;
      scrapedText: string;
      similarity: number;
      resolvedUrl: string;
    }> = [];

    // 4. Scrape and analyze each candidate (multi-page)
    for (const candidate of candidates) {
      let resolvedUrl = candidate.url;

      // BUG-1+2 FIX: If candidate came from a G2 or PH review page, resolve the real vendor URL
      // by scraping the review page itself (not blindly constructing slug.com)
      if (resolvedUrl.includes("g2.com") || resolvedUrl.includes("producthunt.com")) {
        const realUrl = await resolveVendorUrlFromReviewPage(resolvedUrl, candidate.name);
        if (realUrl) resolvedUrl = realUrl;
        else continue; // Can't resolve → skip this candidate
      }

      // Skip our own startup domain
      try {
        const candidateHost = new URL(resolvedUrl).hostname.replace(/^www\./, "");
        const startupHost   = startup.url ? new URL(startup.url).hostname.replace(/^www\./, "") : "";
        if (startupHost && candidateHost === startupHost) continue;
      } catch { /* ignore */ }

      console.info(`[competitor-agent] Multi-page scraping: ${candidate.name} at ${resolvedUrl}`);
      const scrapedText = await scrapeCompetitorMultiPage(resolvedUrl);

      if (!scrapedText || scrapedText.length < 50) continue;

      try {
        const extraction = await runAgent(COMPETITOR_EXTRACTOR_AGENT, {
          competitorName: candidate.name,
          competitorUrl: resolvedUrl,
          // Provide up to 3000 chars (multi-page content)
          homepageText: scrapedText.slice(0, 3000),
        });

        if (extraction) {
          const candidateVec = await embed(scrapedText.slice(0, 1000));
          const similarity   = cosineSimilarity(startupVec, candidateVec);
          candidateSims.push({ candidate, extracted: extraction, scrapedText, similarity, resolvedUrl });
        }
      } catch (err) {
        console.warn(`[competitor-agent] Failed to extract details for candidate ${candidate.name}:`, err);
      }
    }

    // 5. Filter and save candidates — sorted descending by similarity so the best matches come first
    const allScores = candidateSims.map((c) => c.similarity);
    const threshold = computeDynamicThreshold(allScores);
    console.info(`[competitor-agent] Dynamic similarity threshold: ${threshold.toFixed(3)}`);

    // BUG-7 FIX: Sort by similarity DESC before inserting so dashboard ordering is meaningful
    const sortedSims = candidateSims
      .filter(c => c.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    const confirmedCompetitors: CompetitorRow[] = [];

    for (const { candidate, extracted, similarity, resolvedUrl } of sortedSims) {
      const [comp] = await db
        .insert(competitors)
        .values({
          id:               generateULID(),
          startupId,
          idempotencyKey:   weekKey + ":" + resolvedUrl,
          name:             candidate.name,
          url:              resolvedUrl,
          // BUG-4 FIX: Store clean AI-extracted positioningAngle as the display heroCopy
          // Previously stored raw scraped text (noisy headings dump)
          heroCopy:         extracted.positioningAngle,
          positioningAngle: extracted.positioningAngle,
          pricingModel:     extracted.pricingModel || null,
          pricingTiers:     extracted.pricingTiers || [],
          features:         extracted.features || [],
          // BUG-7 FIX: Persist the similarity score for ranking and display
          similarityScore:  Math.round(similarity * 1000) / 1000,
        })
        .onConflictDoNothing()
        .returning();

      if (comp) confirmedCompetitors.push(comp);
    }

    // 6. Strategic Positioning Gaps & Differentiation Opportunities
    if (confirmedCompetitors.length > 0) {
      try {
        const gapResult = await runAgent(POSITIONING_GAP_AGENT, {
          startupName:      startup.name,
          startupIndustry:  extractedProfile.industry,
          startupHeroCopy:  startupText,
          startupServices:  extractedProfile.services,
          startupPricing:   extractedProfile.pricingClues,
          competitors:      confirmedCompetitors.map((c) => ({
            name:       c.name,
            heroCopy:   c.heroCopy,
            positioning: c.positioningAngle,
            pricing:    c.pricingModel,
            features:   c.features,
          })),
        });

        if (gapResult?.gaps && gapResult.gaps.length > 0) {
          await Promise.allSettled(
            gapResult.gaps.map((gap, idx) =>
              db
                .insert(positioningGaps)
                .values({
                  id:             generateULID(),
                  startupId,
                  // BUG-5 FIX: Round-robin attribution across all confirmed competitors
                  // Previously: all overflow gaps assigned to last competitor by index
                  competitorId:   confirmedCompetitors[idx % confirmedCompetitors.length]?.id,
                  idempotencyKey: weekKey + ":gap:" + idx,
                  gapDescription: gap.gapDescription,
                  opportunity:    gap.opportunity ?? null,
                  confidence:     gap.confidence ?? 0.7,
                })
                .onConflictDoNothing()
            ),
          );
        }
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
