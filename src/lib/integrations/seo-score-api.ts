/**
 * Integration client for seoscoreapi.com — with rate-limit-aware caching.
 *
 * getOrFetchSeoAudit() is the entry point for all agents.
 * It caches results in the `seo_audits` table and tracks daily call count
 * in `seo_audit_call_counter` to respect the 2/day free-plan limit.
 *
 * Cache policy:
 *   HIT  → cached row is <7 days old AND content hash unchanged
 *   MISS → no cached row, OR content changed, OR >30 days old (catches backlink changes)
 *   CAP  → daily_call_count >= 2 → return cached/null, queue for next cron
 */

import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { seoAudits, seoAuditCallCounter, websiteScans } from "@/lib/db/schema";
import { sha256 } from "@/lib/db/schema";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SeoScoreAuditResult {
  url: string;
  score: number | null;
  grade: string | null;
  responseTime?: string;
  audit?: {
    meta?:          { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    technical?:     { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    social?:        { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    accessibility?: { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
  };
  /** Normalised: severity→impact, issue→title, fix→description */
  priorities?: Array<{ title?: string; description?: string; impact?: string; category?: string }>;
  aiReadability?: Record<string, unknown>;
  coreWebVitals?: Record<string, unknown>;
  raw?: unknown;
}

export interface CachedAudit {
  result: SeoScoreAuditResult;
  fromCache: boolean;
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Content hash — detects meaningful page changes
// ---------------------------------------------------------------------------

export function computeScanContentHash(
  scan: Pick<
    typeof websiteScans.$inferSelect,
    "title" | "metaDescription" | "h1" | "wordCount"
  >,
): string {
  return sha256(
    `${scan.title ?? ""}|${scan.metaDescription ?? ""}|${scan.h1 ?? ""}|${scan.wordCount ?? 0}`,
  );
}

// ---------------------------------------------------------------------------
// Daily call counter
// ---------------------------------------------------------------------------

async function getTodayCallCount(): Promise<number> {
  const today = todayWindow();
  const [row] = await db
    .select({ callCount: seoAuditCallCounter.callCount })
    .from(seoAuditCallCounter)
    .where(eq(seoAuditCallCounter.callDate, today))
    .limit(1);
  return row?.callCount ?? 0;
}

async function incrementCallCount(): Promise<void> {
  const today = todayWindow();
  const [existing] = await db
    .select()
    .from(seoAuditCallCounter)
    .where(eq(seoAuditCallCounter.callDate, today))
    .limit(1);

  if (existing) {
    await db
      .update(seoAuditCallCounter)
      .set({ callCount: existing.callCount + 1, updatedAt: new Date() })
      .where(eq(seoAuditCallCounter.id, existing.id));
  } else {
    await db.insert(seoAuditCallCounter).values({
      id: generateULID(),
      callDate: today,
      callCount: 1,
      updatedAt: new Date(),
    });
  }
}

// ---------------------------------------------------------------------------
// Cache hit detection
// ---------------------------------------------------------------------------

const CACHE_MAX_AGE_DAYS   = 7;
const FORCE_REFRESH_DAYS   = 30;
const DAILY_CALL_CAP       = 2;

export function isCacheHit(
  cachedAt: Date,
  cachedHash: string,
  currentHash: string,
  nowMs: number = Date.now(),
): boolean {
  const ageMs  = nowMs - cachedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > FORCE_REFRESH_DAYS) return false;        // always refresh after 30 days
  if (cachedHash !== currentHash) return false;           // content changed
  return ageDays <= CACHE_MAX_AGE_DAYS;                  // fresh enough
}

// ---------------------------------------------------------------------------
// Live API call (raw — no caching logic here)
// ---------------------------------------------------------------------------

async function callSeoScoreApi(url: string): Promise<SeoScoreAuditResult | null> {
  const apiKey = process.env.SEO_SCORE_API_KEY;
  if (!apiKey) {
    console.warn("[seo-score-api] SEO_SCORE_API_KEY not set — skipping audit.");
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    console.warn(`[seo-score-api] Invalid URL: ${url}`);
    return null;
  }

  if (
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname.startsWith("127.") ||
    parsedUrl.hostname.startsWith("192.168.") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(parsedUrl.hostname)
  ) {
    console.warn(`[seo-score-api] Skipping local/IP URL: ${url}`);
    return null;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(
      `https://seoscoreapi.com/audit?url=${encodeURIComponent(parsedUrl.toString())}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429 || body.includes("Daily limit") || body.includes("limit exceeded")) {
        console.warn(`[seo-score-api] Rate limit hit for ${url}`);
        return null;
      }
      console.warn(`[seo-score-api] HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as Record<string, unknown>;

    if (
      typeof data.detail === "string" && data.detail.toLowerCase().includes("limit") ||
      typeof data.error === "string" && data.error.toLowerCase().includes("limit")
    ) {
      console.warn(`[seo-score-api] Rate-limit in body for ${url}`);
      return null;
    }

    // BUG-3 FIX: was `?? 70` — silently faked a B-grade when API returned no score
    const rawScore = data.score ?? (data.score_summary as Record<string, unknown>)?.score;
    const score = rawScore != null ? Number(rawScore) : null;
    const grade = (data.grade ?? (data.score_summary as Record<string, unknown>)?.grade ?? null) as string | null;


    const rawPriorities = [
      ...(Array.isArray(data.priorities) ? data.priorities as Record<string, string>[] : []),
      ...(Array.isArray((data.ai_readability as Record<string, unknown>)?.recommendations)
        ? (data.ai_readability as Record<string, unknown[]>).recommendations as Record<string, string>[]
        : []),
    ];

    const priorities = rawPriorities.slice(0, 8).map((p) => ({
      title:       p.issue   || p.title       || "SEO Issue",
      description: p.fix     || p.description || "",
      impact:      p.severity || p.impact      || "medium",
      category:    p.category || "",
    }));

    return {
      url:           data.url as string || parsedUrl.toString(),
      score,
      grade,
      responseTime:  data.response_time as string | undefined,
      audit:         data.audit as SeoScoreAuditResult["audit"],
      priorities,
      aiReadability: data.ai_readability as Record<string, unknown> | undefined,
      coreWebVitals: data.core_web_vitals as Record<string, unknown> | undefined,
      raw:           data,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[seo-score-api] Timeout for ${url}`);
    } else {
      console.error("[seo-score-api] Fetch error:", err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export — cache-aware entry point
// ---------------------------------------------------------------------------

/**
 * getOrFetchSeoAudit — checks the seo_audits cache before calling the live API.
 *
 * @param startupId  Used for the idempotency key and DB association.
 * @param scan       Latest WebsiteScan row (provides content hash inputs + URL).
 * @returns          CachedAudit or null (null = rate-capped or API failure).
 */
export async function getOrFetchSeoAudit(
  startupId: string,
  scan: Pick<
    typeof websiteScans.$inferSelect,
    "id" | "url" | "title" | "metaDescription" | "h1" | "wordCount"
  >,
): Promise<CachedAudit | null> {
  const contentHash = computeScanContentHash(scan);
  const url         = scan.url;

  // 1. Check cache
  const [cached] = await db
    .select()
    .from(seoAudits)
    .where(and(eq(seoAudits.startupId, startupId), eq(seoAudits.url, url)))
    .orderBy(desc(seoAudits.createdAt))
    .limit(1);

  if (cached) {
    const hit = isCacheHit(cached.createdAt, cached.contentHash, contentHash);
    if (hit) {
      console.info(`[seo-score-api] Cache HIT for ${url} (${cached.createdAt.toISOString()})`);
      return {
        result:      JSON.parse(cached.rawJson) as SeoScoreAuditResult,
        fromCache:   true,
        contentHash,
      };
    }
  }

  // 2. Check daily rate cap
  const todayCount = await getTodayCallCount();
  if (todayCount >= DAILY_CALL_CAP) {
    console.warn(
      `[seo-score-api] Daily cap reached (${todayCount}/${DAILY_CALL_CAP}) for ${url}. ` +
      `Queued for next cron run. ${cached ? "Returning stale cache." : "No cache available."}`,
    );
    if (cached) {
      return {
        result:    JSON.parse(cached.rawJson) as SeoScoreAuditResult,
        fromCache: true,
        contentHash,
      };
    }
    return null;
  }

  // 3. Live call
  const result = await callSeoScoreApi(url);
  if (!result) return cached
    ? { result: JSON.parse(cached.rawJson) as SeoScoreAuditResult, fromCache: true, contentHash }
    : null;

  await incrementCallCount();

  // 4. Store in cache
  const iKey = buildIdempotencyKey("SeoAudit", startupId, "seoscoreapi", `${todayWindow()}:${contentHash.slice(0, 8)}`);
  await db.insert(seoAudits).values({
    id:             generateULID(),
    startupId,
    url,
    contentHash,
    score:          result.score ?? 0,   // null → 0 for DB integer column; consumers check fromCache
    grade:          result.grade ?? "—",
    rawJson:        JSON.stringify(result),
    idempotencyKey: iKey,
  }).onConflictDoNothing();

  return { result, fromCache: false, contentHash };
}

/** @deprecated Use getOrFetchSeoAudit() instead */
export async function fetchSeoScoreAudit(url: string): Promise<SeoScoreAuditResult | null> {
  return callSeoScoreApi(url);
}
