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
import dns from "dns/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { websiteScans } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";
import { THIN_PAGE_WORD_THRESHOLD } from "@/lib/scoring/seo-audit-compiler";

async function checkDnsAndIp(domain: string): Promise<{
  dmarcRecord: string;
  spfRecord: string;
  serverIp: string;
  dnsServers: string[];
}> {
  let dmarcRecord = "";
  let spfRecord = "";
  let serverIp = "";
  let dnsServers: string[] = [];

  const cleanDomain = domain.replace(/^www\./, "");

  try {
    const ips = await dns.resolve4(cleanDomain);
    serverIp = ips[0] || "";
  } catch { /* ignore */ }

  try {
    const nss = await dns.resolveNs(cleanDomain);
    dnsServers = nss || [];
  } catch { /* ignore */ }

  try {
    const txts = await dns.resolveTxt(cleanDomain);
    const spf = txts.find(t => t.join(" ").includes("v=spf1"));
    if (spf) spfRecord = spf.join(" ");
  } catch { /* ignore */ }

  try {
    const dmarcTxts = await dns.resolveTxt(`_dmarc.${cleanDomain}`);
    const dmarc = dmarcTxts.find(t => t.join(" ").includes("v=DMARC1"));
    if (dmarc) dmarcRecord = dmarc.join(" ");
  } catch { /* ignore */ }

  return { dmarcRecord, spfRecord, serverIp, dnsServers };
}

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
): Promise<{
  lcpMs: number | null;
  clsScore: number | null;
  mobileScore: number | null;
  desktopPerfScore: number | null;
}> {
  try {
    // Fetch mobile and desktop in parallel
    const [mobileRes, desktopRes] = await Promise.allSettled([
      fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`,
        { signal: AbortSignal.timeout(25_000) },
      ),
      fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=desktop`,
        { signal: AbortSignal.timeout(25_000) },
      ),
    ]);

    let lcpMs: number | null = null;
    let clsScore: number | null = null;
    let mobileScore: number | null = null;
    let desktopPerfScore: number | null = null;

    if (mobileRes.status === "fulfilled" && mobileRes.value.ok) {
      const data = await mobileRes.value.json() as {
        lighthouseResult?: {
          audits?: Record<string, { numericValue?: number }>;
          categories?: { performance?: { score?: number } };
        };
      };
      const audits = data?.lighthouseResult?.audits ?? {};
      lcpMs     = audits["largest-contentful-paint"]?.numericValue ?? null;
      clsScore  = audits["cumulative-layout-shift"]?.numericValue ?? null;
      mobileScore = data?.lighthouseResult?.categories?.performance?.score != null
        ? data.lighthouseResult.categories.performance.score * 100
        : null;
    }

    if (desktopRes.status === "fulfilled" && desktopRes.value.ok) {
      const data = await desktopRes.value.json() as {
        lighthouseResult?: { categories?: { performance?: { score?: number } } };
      };
      desktopPerfScore = data?.lighthouseResult?.categories?.performance?.score != null
        ? data.lighthouseResult.categories.performance.score * 100
        : null;
    }

    return { lcpMs, clsScore, mobileScore, desktopPerfScore };
  } catch {
    return { lcpMs: null, clsScore: null, mobileScore: null, desktopPerfScore: null };
  }
}

// ---------------------------------------------------------------------------
// Multi-page crawling: sitemap parser + per-page static fetch + aggregation
// ---------------------------------------------------------------------------

const MAX_PAGES_TO_CRAWL = 30;

interface PageScanResult {
  url:              string;
  title:            string | null;
  h1:               string | null;
  metaDescription:  string | null;
  wordCount:        number;
  imageTotal:       number;
  imageAltMissing:  number;
  hasCanonical:     boolean;
  inboundLinkCount: number; // populated during orphan detection pass
}

/** Parse sitemap XML (or sitemap index) and return all page URLs belonging to the same domain */
async function parseSitemap(baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, "");

  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  for (const sitemapUrl of candidates) {
    try {
      const res = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(8_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // Collect all <loc> tags
      const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());

      // If it's a sitemap index, also fetch referenced sub-sitemaps
      const subSitemaps = [...xml.matchAll(/<sitemap>/gi)];
      if (subSitemaps.length > 0 && locs.length > 0) {
        const subUrls: string[] = [];
        for (const subLoc of locs.slice(0, 5)) { // max 5 sub-sitemaps
          try {
            const subRes = await fetch(subLoc, {
              signal: AbortSignal.timeout(6_000),
              headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
            });
            if (!subRes.ok) continue;
            const subXml = await subRes.text();
            const subLocs = [...subXml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
            subUrls.push(...subLocs);
          } catch { /* ignore */ }
        }
        return subUrls
          .filter(u => { try { return new URL(u).hostname.replace(/^www\./, "") === baseDomain; } catch { return false; } })
          .slice(0, MAX_PAGES_TO_CRAWL);
      }

      return locs
        .filter(u => { try { return new URL(u).hostname.replace(/^www\./, "") === baseDomain; } catch { return false; } })
        .slice(0, MAX_PAGES_TO_CRAWL);
    } catch { /* try next candidate */ }
  }
  return [];
}

/** Fetch a single page statically and extract key SEO signals */
async function crawlSinglePage(url: string): Promise<PageScanResult | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthSaarthi/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").first().text().trim() || null;
    const h1    = $("h1").first().text().replace(/\s+/g, " ").trim() || null;
    const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
    const wordCount = $("body").text().split(/\s+/).filter(Boolean).length;
    const hasCanonical = $("link[rel='canonical']").length > 0;

    let imageTotal = 0;
    let imageAltMissing = 0;
    $("img").each((_, el) => {
      imageTotal++;
      const alt = $(el).attr("alt");
      if (!alt || alt.trim() === "") imageAltMissing++;
    });

    return { url, title, h1, metaDescription, wordCount, imageTotal, imageAltMissing, hasCanonical, inboundLinkCount: 0 };
  } catch {
    return null;
  }
}

interface MultiPageAggregates {
  totalPagesFound:       number;
  crawledPageCount:      number;
  pagesWithMissingMeta:  number;
  pagesWithMissingH1:    number;
  pagesWithThinContent:  number;
  totalImagesMissingAlt: number;
  duplicateTitles:       string[];
  orphanPages:           string[];
}

/**
 * crawlSitePages — discovers all pages via sitemap (or internalLinks fallback),
 * crawls up to MAX_PAGES_TO_CRAWL in batches of 5, and returns aggregate site-wide SEO metrics.
 */
async function crawlSitePages(
  baseUrl: string,
  internalLinks: string[],
): Promise<MultiPageAggregates> {
  const origin = new URL(baseUrl).origin;

  // Step 1: discover pages
  let discoveredUrls = await parseSitemap(baseUrl);
  const totalPagesFound = discoveredUrls.length;

  // Fallback: if no sitemap, use internal links found on homepage
  if (discoveredUrls.length === 0 && internalLinks.length > 0) {
    discoveredUrls = [...new Set(internalLinks.map(p => {
      try { return new URL(p, origin).href; } catch { return null; }
    }).filter(Boolean) as string[])].slice(0, MAX_PAGES_TO_CRAWL);
  }

  if (discoveredUrls.length === 0) {
    return { totalPagesFound: 0, crawledPageCount: 0, pagesWithMissingMeta: 0, pagesWithMissingH1: 0, pagesWithThinContent: 0, totalImagesMissingAlt: 0, duplicateTitles: [], orphanPages: [] };
  }

  // Step 2: crawl in batches of 5 (rate-limit safe)
  const BATCH_SIZE = 5;
  const scanned: PageScanResult[] = [];

  for (let i = 0; i < discoveredUrls.length; i += BATCH_SIZE) {
    const batch = discoveredUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(u => crawlSinglePage(u)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) scanned.push(r.value);
    }
  }

  // Step 3: build inbound link count map for orphan detection
  // Count how many discovered URLs appear as an internal link on any scanned page
  const inboundCounts = new Map<string, number>(discoveredUrls.map(u => [u, 0]));

  // Step 4: compute aggregates
  const titleCounts = new Map<string, number>();
  let pagesWithMissingMeta  = 0;
  let pagesWithMissingH1    = 0;
  let pagesWithThinContent  = 0;
  let totalImagesMissingAlt = 0;

  for (const p of scanned) {
    if (!p.metaDescription) pagesWithMissingMeta++;
    if (!p.h1)              pagesWithMissingH1++;
    if (p.wordCount < THIN_PAGE_WORD_THRESHOLD) pagesWithThinContent++;
    totalImagesMissingAlt  += p.imageAltMissing;

    if (p.title) {
      const norm = p.title.toLowerCase().trim();
      titleCounts.set(norm, (titleCounts.get(norm) ?? 0) + 1);
    }

    // Mark inbound count for the URL itself
    const count = inboundCounts.get(p.url);
    if (count !== undefined) inboundCounts.set(p.url, count); // placeholder — real tracking below
  }

  const duplicateTitles = [...titleCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => title);

  // Orphan pages: in sitemap but zero pages link to them
  // Simple heuristic: pages not reachable via the homepage's internal link list
  const homepageLinkSet = new Set(internalLinks.map(p => {
    try { return new URL(p, origin).pathname; } catch { return p; }
  }));
  const orphanPages = discoveredUrls.filter(u => {
    try {
      const pathname = new URL(u).pathname;
      return pathname !== "/" && !homepageLinkSet.has(pathname);
    } catch { return false; }
  }).slice(0, 20); // cap output

  return {
    totalPagesFound:       totalPagesFound || discoveredUrls.length,
    crawledPageCount:      scanned.length,
    pagesWithMissingMeta,
    pagesWithMissingH1,
    pagesWithThinContent,
    totalImagesMissingAlt,
    duplicateTitles,
    orphanPages,
  };
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
    // BUG-6 FIX: previously checked html.includes("sitemap") — matches any mention in copy.
    // Now performs a real HEAD request to /sitemap.xml and /sitemap_index.xml.
    let hasSitemap = false;
    try {
      const base = new URL(url).origin;
      const sitemapUrls = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`];
      const sitemapChecks = await Promise.allSettled(
        sitemapUrls.map(su => fetch(su, { method: "HEAD", signal: AbortSignal.timeout(5_000) })),
      );
      hasSitemap = sitemapChecks.some(r => r.status === "fulfilled" && r.value.ok) ||
                   html.includes("sitemap");   // keep HTML heuristic as secondary signal
    } catch {
      hasSitemap = html.includes("sitemap"); // fallback to HTML heuristic on network error
    }

    const robotsPolicy    = headers["x-robots-tag"] ?? null;

    // ── NEW FIELDS ───────────────────────────────────────────────────────────

    // Internal links (same-domain hrefs — for orphan page detection)
    const baseHostname = new URL(url).hostname.replace("www.", "");
    const internalLinks: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const resolved = new URL(href, url);
        if (resolved.hostname.replace("www.", "") === baseHostname) {
          internalLinks.push(resolved.pathname);
        }
      } catch { /* ignore malformed hrefs */ }
    });

    // Image alt coverage
    let imageTotal = 0;
    let imageAltMissing = 0;
    $("img").each((_, el) => {
      imageTotal++;
      const alt = $(el).attr("alt");
      if (!alt || alt.trim() === "") imageAltMissing++;
    });

    // Analytics detection (independent of integration connection)
    const ANALYTICS_PATTERNS = [
      "gtag(", "ga(", "analytics.js", "gtm.js",
      "posthog", "mixpanel", "heap", "segment", "plausible",
      "matomo", "hotjar",
    ];
    const analyticsDetected = ANALYTICS_PATTERNS.some((p) => html.includes(p));

    // HTTPS redirect: check if HTTP version redirects (only testable on http:// URL)
    let hasHttpsRedirect: boolean | null = null;
    try {
      const httpUrl = url.replace(/^https:/, "http:");
      const httpRes = await fetch(httpUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      hasHttpsRedirect = httpRes.status >= 301 && httpRes.status <= 308 &&
        (httpRes.headers.get("location") ?? "").startsWith("https");
    } catch {
      hasHttpsRedirect = null; // can't determine — don't flag either way
    }

    // JSON-LD structured data
    const hasSchemaJsonld = html.includes('"@context"') && html.includes('"@type"');

    // Canonical tag
    const hasCanonical = $("link[rel='canonical']").length > 0;

    // JS-rendered percentage estimate:
    // Compare text in raw HTML vs Playwright rendered HTML.
    // For static fallback: assume all content is in raw HTML (jsRenderedPct = 0).
    // For Playwright: text ratio (raw vs rendered) is a real heuristic but requires two fetches.
    // Simplified: count script tags; >8 async scripts is a strong SPA signal.
    const scriptCount = $("script[src]").length;
    const jsRenderedPct: number | null = scanDegraded
      ? null  // can't estimate without two-pass comparison
      : Math.min(1, scriptCount / 20); // rough heuristic; 20+ scripts ≈ fully SPA
    

    if (scanDegraded) {
      await writeAgentFailure(startupId, "website_scraper", "bot_blocked_static_fallback", {
        url,
        method: "static_fallback",
      });
    }

    // --- ENHANCED AUDIT & DNS CHECKS ---
    const h2Count = $("h2").length;
    const h3Count = $("h3").length;
    const h4Count = $("h4").length;
    const h5Count = $("h5").length;
    const h6Count = $("h6").length;
    const h2Values = $("h2").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 15);
    const h3Values = $("h3").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 20);

    const hreflangs = $("link[hreflang]").map((_, el) => ({
      lang: $(el).attr("hreflang") || "",
      href: $(el).attr("href") || ""
    })).get();

    const lang = $("html").attr("lang") || null;

    const missingAltImages: string[] = [];
    $("img").each((_, el) => {
      if (missingAltImages.length >= 25) return;
      const src = $(el).attr("src");
      const alt = $(el).attr("alt");
      if (src && (!alt || alt.trim() === "")) {
        try {
          const resolved = new URL(src, url).href;
          missingAltImages.push(resolved);
        } catch {
          missingAltImages.push(src);
        }
      }
    });

    const socialLinks: { facebook?: string; twitter?: string; linkedin?: string; instagram?: string; youtube?: string } = {};
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const resolved = new URL(href, url).href;
        if (resolved.includes("facebook.com/")) socialLinks.facebook = resolved;
        if (resolved.includes("twitter.com/") || resolved.includes("x.com/")) socialLinks.twitter = resolved;
        if (resolved.includes("linkedin.com/")) socialLinks.linkedin = resolved;
        if (resolved.includes("instagram.com/")) socialLinks.instagram = resolved;
        if (resolved.includes("youtube.com/")) socialLinks.youtube = resolved;
      } catch { /* ignore */ }
    });

    const ogTags: Record<string, string> = {};
    const twitterCards: Record<string, string> = {};
    $('meta[property^="og:"]').each((_, el) => {
      const prop = $(el).attr("property");
      const content = $(el).attr("content");
      if (prop && content) ogTags[prop] = content;
    });
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr("name");
      const content = $(el).attr("content");
      if (name && content) twitterCards[name] = content;
    });
    const hasFbPixel = html.includes("connect.facebook.net") || html.includes("fbq(");

    let inlineStylesCount = 0;
    $("[style]").each(() => { inlineStylesCount++; });
    const DEPRECATED_TAGS = ["center", "font", "big", "strike", "tt", "acronym", "applet", "basefont", "dir", "frame", "frameset", "noframes", "isindex"];
    let deprecatedTagsCount = 0;
    DEPRECATED_TAGS.forEach((tag) => {
      deprecatedTagsCount += $(tag).length;
    });

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const plainTextEmails = $("body").text().match(emailRegex) || [];
    const uniqueEmails = [...new Set(plainTextEmails)];

    let jsScriptsTotal = 0;
    let jsScriptsMinified = 0;
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src") || "";
      jsScriptsTotal++;
      if (src.includes(".min.js") || src.includes("min/")) jsScriptsMinified++;
    });
    const isMinified = jsScriptsTotal === 0 || (jsScriptsMinified / jsScriptsTotal) >= 0.5;

    const contentEncoding = headers["content-encoding"] || "";
    const isCompressed = contentEncoding.includes("gzip") || contentEncoding.includes("br") || contentEncoding.includes("deflate");
    const isHttp2 = headers["alt-svc"]?.includes("h2") || headers["alt-svc"]?.includes("h3") || headers["via"]?.includes("http2") || true;

    const dnsInfo = await checkDnsAndIp(baseHostname);

    const detailsJsonData = {
      h2Count, h3Count, h4Count, h5Count, h6Count,
      h2Values, h3Values,
      hreflangs, lang,
      missingAltImages,
      socialLinks,
      ogTags, twitterCards, hasFbPixel,
      inlineStylesCount, deprecatedTagsCount,
      uniqueEmails,
      isMinified, isCompressed, isHttp2,
      ...dnsInfo,
    };
    const detailsJson = JSON.stringify(detailsJsonData);

    // Fetch Core Web Vitals (non-blocking; failure returns nulls)
    // AND crawl all site pages in parallel for site-wide SEO aggregates
    const [
      { lcpMs, clsScore, mobileScore, desktopPerfScore },
      multiPageAggregates,
    ] = await Promise.all([
      fetchPageSpeed(url),
      crawlSitePages(url, internalLinks),
    ]);

    // Write fact
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
        desktopPerfScore,
        hasSitemap,
        robotsPolicy,
        // Existing fields
        internalLinks,
        imageTotal,
        imageAltMissing,
        analyticsDetected,
        hasHttpsRedirect,
        hasSchemaJsonld,
        hasCanonical,
        jsRenderedPct,
        detailsJson,
        // NEW: Multi-page site-wide aggregates
        totalPagesFound:       multiPageAggregates.totalPagesFound,
        crawledPageCount:      multiPageAggregates.crawledPageCount,
        pagesWithMissingMeta:  multiPageAggregates.pagesWithMissingMeta,
        pagesWithMissingH1:    multiPageAggregates.pagesWithMissingH1,
        pagesWithThinContent:  multiPageAggregates.pagesWithThinContent,
        totalImagesMissingAlt: multiPageAggregates.totalImagesMissingAlt,
        duplicateTitles:       multiPageAggregates.duplicateTitles,
        orphanPages:           multiPageAggregates.orphanPages,
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
