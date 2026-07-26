/**
 * SEO Ingestion Agent — Unified ingestion across 3 data sources.
 *
 * Priority order:
 *   1. GSC (Google Search Console) — highest confidence, most accurate
 *   2. SerpAPI rank-check fallback — when GSC unavailable, rank-check
 *      candidate keywords derived from website scan + brand voice
 *   3. Competitor keyword diff — extract terms from competitor hero/meta/H1,
 *      identify gaps (present in 2+ competitors, absent in startup)
 *
 * After ingestion:
 *   - Tags every keyword row with `confidence` field
 *   - Runs cold-start detection → updates startups.seo_maturity
 *
 * No LLM calls anywhere in this file.
 * Idempotency: weekly window for GSC/SerpAPI, weekly for competitor diff.
 */

import { eq, and, or, inArray, desc } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/lib/db/client";
import { integrations, keywords, competitors, websiteScans, brandVoices, startups } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, isoWeekWindow, todayWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KeywordRow = typeof keywords.$inferSelect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Tokenise a string into lowercase unique terms of length >= 3 */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

/** Jaccard similarity between two term sets */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((t) => b.has(t)));
  const union        = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ---------------------------------------------------------------------------
// COLD-START DETECTION
// detectColdStart — pure function, exported for unit tests
// ---------------------------------------------------------------------------

export interface ColdStartSignals {
  ownedKeywordCount: number;      // type='owned'
  bestRanking: number;            // lowest (best) ranking position seen
  estimatedTrafficSum: number;    // sum of searchVolume for owned keywords
}

export type SeoMaturity = "cold_start" | "emerging" | "established" | "unknown";

export function detectColdStart(signals: ColdStartSignals): SeoMaturity {
  const { ownedKeywordCount, bestRanking, estimatedTrafficSum } = signals;

  if (ownedKeywordCount < 3 || bestRanking > 20 || estimatedTrafficSum === 0) {
    return "cold_start";
  }
  if (ownedKeywordCount < 15 || bestRanking > 10) {
    return "emerging";
  }
  return "established";
}

// ---------------------------------------------------------------------------
// 1. GSC INGESTION
// ---------------------------------------------------------------------------

async function runGscIngestion(
  startupId: string,
  domain: string,
): Promise<KeywordRow[] | null> {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.startupId, startupId),
        eq(integrations.type, "gsc"),
        eq(integrations.connected, true),
      ),
    )
    .limit(1);

  if (!integration) return null;

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const weekKey = buildIdempotencyKey("SeoScan", startupId, "gsc", isoWeekWindow());
  const [alreadyRan] = await db
    .select({ id: keywords.id })
    .from(keywords)
    .where(eq(keywords.idempotencyKey, `${weekKey}:0`))
    .limit(1);
  if (alreadyRan) {
    return db.select().from(keywords).where(eq(keywords.startupId, startupId));
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({
    access_token:  integration.accessToken,
    refresh_token: integration.refreshToken,
  });

  const webmasters = google.webmasters({ version: "v3", auth });
  const siteUrl    = domain.startsWith("http") ? domain : `https://${domain}`;

  const res = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate:  nDaysAgo(28),
      endDate:    nDaysAgo(0),
      dimensions: ["query", "page"],
      rowLimit:   100,
    },
  });

  const rows    = (res.data.rows ?? []) as Array<{
    keys: string[]; clicks: number; impressions: number; ctr: number; position: number;
  }>;
  const written: KeywordRow[] = [];

  for (const [idx, row] of rows.entries()) {
    const term    = row.keys[0] ?? "";
    const ranking = Math.round(row.position);
    if (!term) continue;

    const iKey = `${weekKey}:${idx}`;
    const [kw] = await db
      .insert(keywords)
      .values({
        id:             generateULID(),
        startupId,
        idempotencyKey: iKey,
        term,
        searchVolume:   row.impressions,
        startupRanking: ranking,
        type:           ranking <= 10 ? "owned" : "gap",
        confidence:     "gsc",
        competitorCount: 0,
      })
      .onConflictDoNothing()
      .returning();

    if (kw) written.push(kw);
  }

  // Update prior_ranking for existing owned keywords (for content_decay detection)
  const prevWeek = isoWeekWindow(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  for (const kw of written) {
    if (kw.type === "owned" && kw.priorRankingWeek !== isoWeekWindow()) {
      await db
        .update(keywords)
        .set({ priorRanking: kw.startupRanking, priorRankingWeek: prevWeek })
        .where(
          and(
            eq(keywords.startupId, startupId),
            eq(keywords.term, kw.term),
          ),
        );
    }
  }

  return written;
}

// ---------------------------------------------------------------------------
// 2. SERPAPI RANK-CHECK FALLBACK
// ---------------------------------------------------------------------------

async function runSerpApiRankCheck(
  startupId: string,
  candidateTerms: string[],
  domain: string,
): Promise<KeywordRow[]> {
  const serpKey = process.env.SERPAPI_KEY;
  if (!serpKey || candidateTerms.length === 0) return [];

  const weekKey = buildIdempotencyKey("SeoScan", startupId, "serpapi", isoWeekWindow());
  const [alreadyRan] = await db
    .select({ id: keywords.id })
    .from(keywords)
    .where(eq(keywords.idempotencyKey, `${weekKey}:0`))
    .limit(1);
  if (alreadyRan) return [];

  const written: KeywordRow[] = [];

  for (const [idx, term] of candidateTerms.slice(0, 10).entries()) {
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(term)}&api_key=${serpKey}&num=20`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;

      const data = await res.json() as {
        organic_results?: Array<{ link?: string; position?: number }>;
      };

      const orgResults = data.organic_results ?? [];
      const myResult   = orgResults.find((r) =>
        r.link && new URL(r.link).hostname.replace("www.", "") === domain.replace("www.", ""),
      );

      const ranking = myResult?.position ?? 100; // 100 = not found in top 20

      const iKey = `${weekKey}:${idx}`;
      const [kw] = await db
        .insert(keywords)
        .values({
          id:             generateULID(),
          startupId,
          idempotencyKey: iKey,
          term,
          searchVolume:   null, // SerpAPI free doesn't include volume
          startupRanking: ranking,
          type:           ranking <= 10 ? "owned" : "gap",
          confidence:     "serpapi_rank",
          competitorCount: 0,
        })
        .onConflictDoNothing()
        .returning();

      if (kw) written.push(kw);
    } catch {
      // Non-fatal — continue with remaining terms
    }
  }

  return written;
}

// ---------------------------------------------------------------------------
// 3. COMPETITOR KEYWORD DIFF
// ---------------------------------------------------------------------------

async function runCompetitorKeywordDiff(startupId: string): Promise<KeywordRow[]> {
  const [latestScan] = await db
    .select()
    .from(websiteScans)
    .where(eq(websiteScans.startupId, startupId))
    .orderBy(desc(websiteScans.createdAt))   // BUG-1 FIX: was ASC → returned oldest scan
    .limit(1);

  const competitorRows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.startupId, startupId));

  if (competitorRows.length === 0) return [];

  // Startup's own keyword set (terms only)
  const existingKeywords = await db
    .select({ term: keywords.term })
    .from(keywords)
    .where(eq(keywords.startupId, startupId));
  const ownedTerms = new Set(existingKeywords.map((k) => k.term.toLowerCase()));

  // Tokenise each competitor's content
  const competitorTermMaps: Map<string, Set<string>> = new Map();
  for (const comp of competitorRows) {
    const text  = [comp.heroCopy, comp.positioningAngle, comp.pricingModel]
      .filter(Boolean)
      .join(" ");
    if (text.trim().length > 0) {
      competitorTermMaps.set(comp.id, tokenise(text));
    }
  }

  // Count how many competitors use each term
  const termCompetitorCount: Map<string, number> = new Map();
  for (const termSet of competitorTermMaps.values()) {
    for (const term of termSet) {
      if (!ownedTerms.has(term)) {
        termCompetitorCount.set(term, (termCompetitorCount.get(term) ?? 0) + 1);
      }
    }
  }

  // Terms appearing in 2+ competitors but absent from startup → competitive_gap
  const gapTerms = [...termCompetitorCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20); // cap at 20 to avoid noise

  const weekKey = buildIdempotencyKey("CompetitorKeywordDiff", startupId, "cheerio", isoWeekWindow());
  const written: KeywordRow[] = [];

  for (const [idx, [term, compCount]] of gapTerms.entries()) {
    const iKey = `${weekKey}:${idx}`;
    const [kw] = await db
      .insert(keywords)
      .values({
        id:             generateULID(),
        startupId,
        idempotencyKey: iKey,
        term,
        searchVolume:   null,
        startupRanking: null,
        type:           "competitive_gap",
        confidence:     "competitor_inferred",
        competitorCount: compCount,
      })
      .onConflictDoNothing()
      .returning();

    if (kw) written.push(kw);
  }

  void latestScan; // referenced for context; used in caller for candidate terms

  return written;
}

// ---------------------------------------------------------------------------
// Derive candidate keywords from scan + brand voice (for SerpAPI fallback)
// ---------------------------------------------------------------------------

async function deriveCandidateKeywords(startupId: string): Promise<string[]> {
  const [scan] = await db
    .select()
    .from(websiteScans)
    .where(eq(websiteScans.startupId, startupId))
    .orderBy(desc(websiteScans.createdAt))   // BUG-1 FIX: was ASC → returned oldest scan
    .limit(1);

  const candidates = new Set<string>();

  if (scan) {
    for (const text of [scan.title, scan.h1, scan.metaDescription]) {
      if (text) {
        for (const tok of tokenise(text)) candidates.add(tok);
      }
    }
  }

  // Merge brand voice examples if they exist (skip gracefully if not)
  const [voice] = await db
    .select({ examplesJson: brandVoices.examplesJson })
    .from(brandVoices)
    .where(eq(brandVoices.startupId, startupId))
    .orderBy(brandVoices.createdAt)
    .limit(1);

  if (voice?.examplesJson) {
    try {
      const examples = JSON.parse(voice.examplesJson) as string[];
      for (const ex of examples) {
        for (const tok of tokenise(ex)) candidates.add(tok);
      }
    } catch {
      // skip — malformed brand voice JSON
    }
  }

  // Filter out single-char tokens and very common stop words
  const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "are", "your", "our", "can", "not", "you"]);
  return [...candidates].filter((t) => t.length >= 4 && !STOP_WORDS.has(t)).slice(0, 15);
}

// ---------------------------------------------------------------------------
// COLD-START UPDATE (writes to DB)
// ---------------------------------------------------------------------------

async function updateSeoMaturity(startupId: string): Promise<SeoMaturity> {
  const ownedRows = await db
    .select()
    .from(keywords)
    .where(
      and(
        eq(keywords.startupId, startupId),
        eq(keywords.type, "owned"),
      ),
    );

  const signals: ColdStartSignals = {
    ownedKeywordCount:  ownedRows.length,
    bestRanking:        ownedRows.length > 0 ? Math.min(...ownedRows.map((k) => k.startupRanking ?? 100)) : 999,
    estimatedTrafficSum: ownedRows.reduce((sum, k) => sum + (k.searchVolume ?? 0), 0),
  };

  const maturity = detectColdStart(signals);

  await db
    .update(startups)
    .set({ seoMaturity: maturity, updatedAt: new Date() })
    .where(eq(startups.id, startupId));

  console.info(`[seo-agent] seoMaturity for ${startupId} = ${maturity} (${signals.ownedKeywordCount} owned keywords, best rank: ${signals.bestRanking})`);
  return maturity;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

export async function runSeoIngestion(
  startupId: string,
  domain: string,
): Promise<{ keywords: KeywordRow[]; seoMaturity: SeoMaturity } | null> {
  try {
    // Run all three sources in parallel (failure-isolated)
    const [gscResult, compDiffResult] = await Promise.allSettled([
      runGscIngestion(startupId, domain),
      runCompetitorKeywordDiff(startupId),
    ]);

    let allWritten: KeywordRow[] = [];

    const gscKeywords = gscResult.status === "fulfilled" ? gscResult.value ?? [] : [];
    const compKeywords = compDiffResult.status === "fulfilled" ? compDiffResult.value : [];

    if (gscResult.status === "rejected") {
      await writeAgentFailure(startupId, "seo_agent_gsc", gscResult.reason, { domain });
    }
    if (compDiffResult.status === "rejected") {
      await writeAgentFailure(startupId, "seo_agent_comp_diff", compDiffResult.reason);
    }

    allWritten = [...gscKeywords, ...compKeywords];

    // SerpAPI fallback — only if GSC returned nothing
    if (gscKeywords.length === 0) {
      console.info(`[seo-agent] No GSC data for ${startupId} — falling back to SerpAPI rank-check`);
      const candidates = await deriveCandidateKeywords(startupId);
      const serpKeywords = await runSerpApiRankCheck(startupId, candidates, domain).catch(async (err) => {
        await writeAgentFailure(startupId, "seo_agent_serp", err, { domain });
        return [] as KeywordRow[];
      });
      allWritten = [...allWritten, ...serpKeywords];
    }

    // Cold-start detection
    const seoMaturity = await updateSeoMaturity(startupId);

    return { keywords: allWritten, seoMaturity };
  } catch (err) {
    await writeAgentFailure(startupId, "seo_agent", err, { domain });
    return null;
  }
}
