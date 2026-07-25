/**
 * Website Scraper Agent
 *
 * Flow:
 *   1. Check idempotency key — skip if already scanned today.
 *   2. Try Playwright (headless Chromium); fall back to fetch()+cheerio on timeout/block.
 *   3. Parse title, meta, h1, hero copy, CTAs, tech-stack (pure string matching, no LLM).
 *   4. Call Google PageSpeed Insights (free, no key for low volume) for LCP + CLS.
 *   5. Write WebsiteScan fact.
 *   6. On ANY error: write AgentFailure fact, return null — never throw.
 */

import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// Tech-stack fingerprints — pure string matching, zero LLM calls (spec §3.2)
// ---------------------------------------------------------------------------

const FINGERPRINTS: Record<string, string[]> = {
  "next.js":           ["__NEXT_DATA__", "_next/static"],
  "wordpress":         ["wp-content", "wp-json"],
  "shopify":           ["cdn.shopify.com", "Shopify.theme"],
  "webflow":           ["webflow.com", "data-wf-page"],
  "react":             ["react-root", "__reactFiber", "__react"],
  "vue":               ["__vue__", "data-v-app"],
  "stripe":            ["js.stripe.com"],
  "google-analytics":  ["gtag(", "UA-", "G-0", "G-1", "G-2", "G-3", "G-4", "G-5", "G-6", "G-7", "G-8", "G-9"],
  "intercom":          ["intercom-frame", "widget.intercom.io"],
  "hotjar":            ["hotjar", "hj.q"],
  "vercel":            ["/_vercel/", "x-vercel-id"],
  "cloudflare":        ["cf-ray", "__cf_bm"],
};

function detectTechStack(html: string, headerStr: string): string[] {
  const haystack = html + headerStr;
  return Object.entries(FINGERPRINTS)
    .filter(([, signals]) => signals.some((s) => haystack.includes(s)))
    .map(([tech]) => tech);
}

// ---------------------------------------------------------------------------
// CTA extraction — button and anchor tags with short, action-oriented text
// ---------------------------------------------------------------------------

function parseCtaTexts($: ReturnType<typeof cheerio.load>): string[] {
  const seen = new Set<string>();
  $("button, a[href]").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && text.length >= 2 && text.length <= 60) seen.add(text);
  });
  return [...seen].slice(0, 15);
}

// ---------------------------------------------------------------------------
// Google PageSpeed Insights — free, no API key needed for <25k req/day
// ---------------------------------------------------------------------------

async function fetchPageSpeed(
  url: string,
): Promise<{ lcpMs: number | null; clsScore: number | null; mobileScore: number | null }> {
  try {
    const psiUrl =
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
      `?url=${encodeURIComponent(url)}&strategy=mobile`;
    const res = await fetch(psiUrl, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return { lcpMs: null, clsScore: null, mobileScore: null };
    const data = (await res.json()) as {
      lighthouseResult?: {
        audits?: Record<string, { numericValue?: number }>;
        categories?: { performance?: { score?: number } };
      };
    };
    const audits = data?.lighthouseResult?.audits ?? {};
    return {
      lcpMs:       audits["largest-contentful-paint"]?.numericValue ?? null,
      clsScore:    audits["cumulative-layout-shift"]?.numericValue ?? null,
      mobileScore: (data?.lighthouseResult?.categories?.performance?.score ?? null) !== null
        ? (data.lighthouseResult!.categories!.performance!.score! * 100)
        : null,
    };
  } catch {
    return { lcpMs: null, clsScore: null, mobileScore: null };
  }
}

// ---------------------------------------------------------------------------
// Page fetching — Playwright primary, fetch+cheerio fallback
// ---------------------------------------------------------------------------

interface PageData {
  html: string;
  headers: Record<string, string>;
  degraded: boolean;
}

async function fetchWithPlaywright(url: string): Promise<PageData> {
  // Dynamic import keeps playwright out of the client bundle
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (compatible; GrowthSaarthi/1.0; +https://growthsaarthi.ai/bot)",
    });
    const response = await page.goto(url, {
      timeout: 15_000,
      waitUntil: "domcontentloaded",
    });
    const html = await page.content();
    const headers: Record<string, string> = {};
    if (response) {
      Object.entries(response.headers()).forEach(([k, v]) => {
        headers[k] = String(v);
      });
    }
    return { html, headers, degraded: false };
  } finally {
    await browser.close();
  }
}

async function fetchWithStaticFallback(url: string): Promise<PageData> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GrowthSaarthi/1.0; +https://growthsaarthi.ai/bot)",
    },
  });
  const html = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { html, headers, degraded: true };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type WebsiteScanRow = typeof websiteScans.$inferSelect;

export async function scrapeWebsite(
  startupId: string,
  url: string,
): Promise<WebsiteScanRow | null> {
  const idempotencyKey = buildIdempotencyKey(
    "WebsiteScan",
    startupId,
    "playwright",
    todayWindow(),
  );

  try {
    // Idempotency check — already scanned today?
    const [existing] = await db
      .select()
      .from(websiteScans)
      .where(eq(websiteScans.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return existing;

    // Fetch page content
    let pageData: PageData;
    let scanDegraded = false;
    try {
      pageData = await fetchWithPlaywright(url);
    } catch (playwrightErr) {
      console.warn(
        "[website-scraper] Playwright failed, falling back to static fetch:",
        playwrightErr,
      );
      pageData = await fetchWithStaticFallback(url);
      scanDegraded = true;
    }

    const { html, headers } = pageData;
    const $ = cheerio.load(html);
    const headerStr = JSON.stringify(headers);

    // Parse page elements
    const title           = $("title").first().text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
    const h1              = $("h1").first().text().replace(/\s+/g, " ").trim() || null;
    
    // Find logo / favicon URL
    let logoUrl: string | null = null;
    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;
      
      let extracted = $("link[rel='apple-touch-icon']").attr("href") ||
                      $("link[rel='icon']").attr("href") ||
                      $("link[rel='shortcut icon']").attr("href") ||
                      $('meta[property="og:image"]').attr("content");
                      
      if (!extracted) {
        $("img").each((_, el) => {
          const src = $(el).attr("src");
          const alt = $(el).attr("alt")?.toLowerCase() || "";
          const id = $(el).attr("id")?.toLowerCase() || "";
          const className = $(el).attr("class")?.toLowerCase() || "";
          
          if (src && (alt.includes("logo") || id.includes("logo") || className.includes("logo"))) {
            extracted = src;
            return false;
          }
        });
      }
      
      if (extracted) {
        logoUrl = new URL(extracted, url).href;
      } else {
        logoUrl = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
      }
    } catch {
      logoUrl = null;
    }

    const heroCopy        = ($("[class*='hero'], [id*='hero'], main, [role='main']")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500)) || null;
    const ctaTexts        = parseCtaTexts($);
    const techStack       = detectTechStack(html, headerStr);
    const wordCount       = $("body").text().split(/\s+/).filter(Boolean).length;
    const hasSitemap      =
      html.includes("sitemap") || headers["x-sitemap"] !== undefined;
    const robotsPolicy    = headers["x-robots-tag"] ?? null;

    if (scanDegraded) {
      await writeAgentFailure(startupId, "website_scraper", "bot_blocked_static_fallback", {
        url,
        method: "static_fallback",
      });
    }

    // Fetch Core Web Vitals (non-blocking; failure returns nulls)
    const { lcpMs, clsScore, mobileScore } = await fetchPageSpeed(url);

    // Write fact — onConflictDoNothing handles any TOCTOU race
    const [scan] = await db
      .insert(websiteScans)
      .values({
        id:             generateULID(),
        startupId,
        idempotencyKey,
        url,
        logoUrl,
        title,
        metaDescription,
        h1,
        heroCopy,
        ctaTexts,
        techStack,
        wordCount,
        lcpMs,
        clsScore,
        mobileScore,
        hasSitemap,
        robotsPolicy,
      })
      .onConflictDoNothing()
      .returning();

    // If conflict fired (TOCTOU), re-fetch the existing row
    if (!scan) {
      const [found] = await db
        .select()
        .from(websiteScans)
        .where(eq(websiteScans.idempotencyKey, idempotencyKey))
        .limit(1);
      return found ?? null;
    }

    return scan;
  } catch (err) {
    await writeAgentFailure(startupId, "website_scraper", err, { url });
    return null;
  }
}
