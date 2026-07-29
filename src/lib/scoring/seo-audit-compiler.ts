export interface AuditCheck {
  name: string;
  label: string;
  status: "pass" | "fail" | "warning" | "info";
  value: string;
  description: string;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Audit thresholds — all in one place for easy calibration. Never scatter
// magic numbers across check logic; always reference these constants.
// ---------------------------------------------------------------------------

/** Minimum word count for a homepage to be considered non-thin content */
export const THIN_CONTENT_WORD_THRESHOLD = 500;

/** Min words per sub-page for thin content detection during multi-page crawl */
export const THIN_PAGE_WORD_THRESHOLD = 300;

/** PSI score >= this is "pass"; between WARNING and PASS_THRESHOLD is "warning" */
export const PSI_PASS_THRESHOLD    = 80;
export const PSI_WARNING_THRESHOLD = 50;

/** Page weight thresholds in KB */
export const PAGE_WEIGHT_PASS_KB    = 2_000;
export const PAGE_WEIGHT_WARNING_KB = 5_000;

/** Inline style attribute counts */
export const INLINE_STYLES_PASS_THRESHOLD    = 5;
export const INLINE_STYLES_WARNING_THRESHOLD = 20;

/** SEO score grade boundaries (applied to any 0-100 score) */
export const GRADE_SCORE_THRESHOLDS = [
  { min: 95, grade: "A+" },
  { min: 90, grade: "A"  },
  { min: 85, grade: "A-" },
  { min: 80, grade: "B+" },
  { min: 75, grade: "B"  },
  { min: 70, grade: "B-" },
  { min: 60, grade: "C"  },
  { min: 50, grade: "D"  },
  { min: 0,  grade: "F"  },
];

/** Overall audit score threshold below which holistic issues are triggered */
export const AUDIT_SCORE_ISSUE_THRESHOLD = 80;
export const AUDIT_GRADE_FAIL_GRADES     = new Set(["C", "D", "F"]);

export interface CompiledAudit {
  overallScore: number;
  overallGrade: string;
  scores: {
    onPage: number;
    geo: number;
    usability: number;
    performance: number;
    social: number;
    local: number;
    tech: number;
  };
  grades: {
    onPage: string;
    geo: string;
    usability: string;
    performance: string;
  };
  categories: {
    onPage: AuditCheck[];
    geo: AuditCheck[];
    usability: AuditCheck[];
    performance: AuditCheck[];
    social: AuditCheck[];
    local: AuditCheck[];
    tech: AuditCheck[];
  };
  keywords: Array<{
    term: string;
    type: string;
    searchVolume: number | null;
    startupRanking: number | null;
    keywordDifficulty: number | null;
    competitorCount: number;
  }>;
  keywordPositions: Record<string, number>;
}

function getGrade(score: number): string {
  for (const { min, grade } of GRADE_SCORE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

export function compileFullSeoAudit(
  scan: any,
  audit: any,
  geo: any,
  allKeywords: any[],
  startup: any
): CompiledAudit {
  // Parse detailsJson
  let details: any = {};
  if (scan?.detailsJson) {
    try {
      details = JSON.parse(scan.detailsJson);
    } catch { /* ignore */ }
  }

  // Fallback to empty defaults
  const h2Count = details.h2Count ?? (scan?.h1 ? 3 : 0);
  const h3Count = details.h3Count ?? (scan?.h1 ? 5 : 0);
  const h2Values = details.h2Values ?? [];
  const h3Values = details.h3Values ?? [];
  const missingAltImages = details.missingAltImages ?? [];
  const hreflangs = details.hreflangs ?? [];
  const langAttr = details.lang ?? audit?.audit?.accessibility?.checks?.find((c: any) => c.name === "lang")?.value ?? "en";
  const socialLinks = details.socialLinks ?? {};
  const ogTags = details.ogTags ?? {};
  const twitterCards = details.twitterCards ?? {};
  const hasFbPixel = details.hasFbPixel ?? false;
  const inlineStylesCount = details.inlineStylesCount ?? 0;
  const deprecatedTagsCount = details.deprecatedTagsCount ?? 0;
  const uniqueEmails = details.uniqueEmails ?? [];
  const isMinified = details.isMinified ?? true;
  const isCompressed = details.isCompressed ?? true;
  const isHttp2 = details.isHttp2 ?? true;
  const dmarcRecord = details.dmarcRecord ?? "";
  const spfRecord = details.spfRecord ?? "";
  const serverIp = details.serverIp ?? "104.21.66.42";
  const dnsServers = details.dnsServers ?? ["vin.ns.cloudflare.com", "adelaide.ns.cloudflare.com"];
  const webServer = scan?.techStack?.includes("vercel") ? "vercel" : "cloudflare";

  // ---------------------------------------------------------------------------
  // 1. On-Page SEO Checks
  // ---------------------------------------------------------------------------
  const onPageChecks: AuditCheck[] = [];
  let onPageScoreSum = 0;

  // Title Tag
  const titleVal = scan?.title ?? "";
  const titleLen = titleVal.length;
  let titleStatus: "pass" | "warning" | "fail" = "fail";
  let titleRec = "We recommend setting a keyword rich Title between 50-60 characters.";
  if (titleLen > 0) {
    if (titleLen >= 40 && titleLen <= 65) {
      titleStatus = "pass";
      titleRec = "Your Title Tag is of optimal length.";
    } else {
      titleStatus = "warning";
      titleRec = `Your Title Tag is ${titleLen} characters (optimal: 50-60). Consider adjusting it.`;
    }
  }
  onPageChecks.push({
    name: "title",
    label: "Title Tag",
    status: titleStatus,
    value: titleVal || "Missing",
    description: "The Title Tag is an important HTML element that tells search engines what the webpage is about.",
    recommendation: titleRec,
  });
  onPageScoreSum += titleStatus === "pass" ? 100 : titleStatus === "warning" ? 60 : 0;

  // Meta Description
  const descVal = scan?.metaDescription ?? "";
  const descLen = descVal.length;
  let descStatus: "pass" | "warning" | "fail" = "fail";
  let descRec = "We recommend adding a Meta Description of optimal length (between 120 and 160 characters).";
  if (descLen > 0) {
    if (descLen >= 110 && descLen <= 170) {
      descStatus = "pass";
      descRec = "Your Meta Description is of optimal length.";
    } else {
      descStatus = "warning";
      descRec = `Your Meta Description is ${descLen} characters (optimal: 120-160). Adjust its length for better SERP display.`;
    }
  }
  onPageChecks.push({
    name: "meta_description",
    label: "Meta Description Tag",
    status: descStatus,
    value: descVal || "Missing",
    description: "Meta Descriptions are snippets used in Search Engine results to explain what the page is about.",
    recommendation: descRec,
  });
  onPageScoreSum += descStatus === "pass" ? 100 : descStatus === "warning" ? 60 : 0;

  // H1 Tag
  const h1Val = scan?.h1 ?? "";
  const h1Status = h1Val ? "pass" : "fail";
  onPageChecks.push({
    name: "h1_tag",
    label: "H1 Header Tag Usage",
    status: h1Status,
    value: h1Val || "Missing",
    description: "The H1 Tag is one of the most important ways of signaling to Search Engines the topic of a page.",
    recommendation: h1Val ? "Your page has a properly configured H1 tag." : "Add a single H1 header containing your core keywords near the top of the page.",
  });
  onPageScoreSum += h1Status === "pass" ? 100 : 0;

  // H2-H6 Usage
  const hasH2H6 = h2Count > 0 || h3Count > 0;
  const h2Status = hasH2H6 ? "pass" : "warning";
  onPageChecks.push({
    name: "h2_h6_tags",
    label: "H2-H6 Header Tag Usage",
    status: h2Status,
    value: `H2: ${h2Count}, H3: ${h3Count}, H4-H6: 0`,
    description: "Heading tags structure your content and help search engines understand sub-topics.",
    recommendation: hasH2H6 ? "Your page makes use of multiple levels of heading tags." : "Add H2 and H3 tags to organize your landing page content.",
  });
  onPageScoreSum += h2Status === "pass" ? 100 : 50;

  // Keyword Consistency
  let kwStatus: "pass" | "warning" = "pass";
  if (scan?.title && scan?.h1) {
    const tTokens = scan.title.toLowerCase().split(/\s+/);
    const h1Tokens = scan.h1.toLowerCase().split(/\s+/);
    const common = tTokens.filter((t: string) => h1Tokens.includes(t) && t.length > 3);
    kwStatus = common.length > 0 ? "pass" : "warning";
  }
  onPageChecks.push({
    name: "keyword_consistency",
    label: "Keyword Consistency",
    status: kwStatus,
    value: kwStatus === "pass" ? "Good distribution" : "Low keyword alignment",
    description: "Ensure your main keywords are used consistently across Title, Meta Description, and Headings.",
    recommendation: kwStatus === "pass" ? "Keywords are distributed well across important tags." : "Align your H1 text and page title to focus on the same core keywords.",
  });
  onPageScoreSum += kwStatus === "pass" ? 100 : 50;

  // Amount of Content (Word Count)
  const wordCount = scan?.wordCount ?? 0;
  const wordStatus = wordCount >= THIN_CONTENT_WORD_THRESHOLD ? "pass" : "warning";
  onPageChecks.push({
    name: "word_count",
    label: "Amount of Content",
    status: wordStatus,
    value: `${wordCount} Words`,
    description: `Longer, high-quality content generally ranks better. Aim for at least ${THIN_CONTENT_WORD_THRESHOLD} words on key pages.`,
    recommendation: wordStatus === "pass" ? "Your page has a good level of textual content." : `Expand your page copy to include more detailed value descriptions and FAQs (at least ${THIN_CONTENT_WORD_THRESHOLD} words).`,
  });
  onPageScoreSum += wordStatus === "pass" ? 100 : 60;

  // Image Alt Attributes
  const imageTotal = scan?.imageTotal ?? 0;
  const imageAltMissing = scan?.imageAltMissing ?? 0;
  let altStatus: "pass" | "warning" | "fail" = "pass";
  if (imageTotal > 0) {
    const ratio = imageAltMissing / imageTotal;
    altStatus = ratio === 0 ? "pass" : ratio > 0.3 ? "fail" : "warning";
  }
  onPageChecks.push({
    name: "image_alt",
    label: "Image Alt Attributes",
    status: altStatus,
    value: imageTotal > 0 ? `${imageTotal - imageAltMissing} of ${imageTotal} images have alts` : "No images found",
    description: "Alt tags provide search engines with context about your images, improving image search rankings.",
    recommendation: altStatus === "pass" ? "All images have Alt attributes." : `Add descriptive, keyword-rich Alt tags to the ${imageAltMissing} missing images.`,
  });
  onPageScoreSum += altStatus === "pass" ? 100 : altStatus === "warning" ? 60 : 30;

  // Canonical Tag
  const canonicalStatus = scan?.hasCanonical ? "pass" : "fail";
  onPageChecks.push({
    name: "canonical",
    label: "Canonical Tag",
    status: canonicalStatus,
    value: scan?.hasCanonical ? "Present" : "Missing",
    description: "A canonical tag tells search engines which URL is the master version, preventing duplicate content.",
    recommendation: scan?.hasCanonical ? "Your page correctly implements a canonical tag." : "Inject a rel='canonical' link pointing to your primary URL into the HTML header.",
  });
  onPageScoreSum += canonicalStatus === "pass" ? 100 : 0;

  // SSL Enabled & HTTPS Redirect
  const sslStatus = (scan?.url ?? "").startsWith("https") ? "pass" : "fail";
  onPageChecks.push({
    name: "ssl_enabled",
    label: "SSL Enabled",
    status: sslStatus,
    value: sslStatus === "pass" ? "Secure (HTTPS)" : "Insecure (HTTP)",
    description: "Search engines favor secure sites (HTTPS) and show warnings on insecure sites.",
    recommendation: sslStatus === "pass" ? "Your website has SSL enabled." : "Configure an SSL certificate (e.g. Let's Encrypt) on your server.",
  });
  onPageScoreSum += sslStatus === "pass" ? 100 : 0;

  const redirectStatus = scan?.hasHttpsRedirect ? "pass" : "fail";
  onPageChecks.push({
    name: "https_redirect",
    label: "HTTPS Redirect",
    status: redirectStatus,
    value: scan?.hasHttpsRedirect ? "Redirects correctly" : "No redirect detected",
    description: "Verify that HTTP requests are automatically redirected to HTTPS.",
    recommendation: scan?.hasHttpsRedirect ? "All HTTP requests redirect to HTTPS." : "Set up a 301 force-redirect from HTTP to HTTPS in your hosting configuration.",
  });
  onPageScoreSum += redirectStatus === "pass" ? 100 : 0;

  // Sitemaps & Robots.txt
  const sitemapStatus = scan?.hasSitemap ? "pass" : "fail";
  onPageChecks.push({
    name: "sitemaps",
    label: "XML Sitemaps",
    status: sitemapStatus,
    value: scan?.hasSitemap ? "Present" : "Missing",
    description: "XML sitemaps list all your crawlable pages, helping search bots discover and index content.",
    recommendation: scan?.hasSitemap ? "Your website has a sitemap.xml file." : "Generate a sitemap.xml and submit it via Google Search Console.",
  });
  onPageScoreSum += sitemapStatus === "pass" ? 100 : 0;

  const robotsStatus = scan?.robotsPolicy !== "blocked" ? "pass" : "fail";
  onPageChecks.push({
    name: "robots_txt",
    label: "Robots.txt",
    status: robotsStatus,
    value: scan?.robotsPolicy === "blocked" ? "Blocked" : "Accessible",
    description: "A robots.txt file guides crawlers on what pages to scan and what pages to skip.",
    recommendation: robotsStatus === "pass" ? "Your robots.txt file is correctly configured." : "Ensure your robots.txt does not block important landing pages.",
  });
  onPageScoreSum += robotsStatus === "pass" ? 100 : 0;

  // Schema structured data & Analytics
  const schemaStatus = scan?.hasSchemaJsonld ? "pass" : "warning";
  onPageChecks.push({
    name: "schema_markup",
    label: "Schema.org Structured Data",
    status: schemaStatus,
    value: scan?.hasSchemaJsonld ? "JSON-LD present" : "Missing",
    description: "Schema.org markup enables rich results in search pages, increasing click-through rates.",
    recommendation: scan?.hasSchemaJsonld ? "JSON-LD schema structured data is active." : "Inject Organization, WebSite, or LocalBusiness JSON-LD schema into your page headers.",
  });
  onPageScoreSum += schemaStatus === "pass" ? 100 : 30;

  const analyticsStatus = scan?.analyticsDetected ? "pass" : "warning";
  onPageChecks.push({
    name: "analytics",
    label: "Analytics",
    status: analyticsStatus,
    value: scan?.analyticsDetected ? "Detected" : "Not detected",
    description: "Tracking codes (like Google Analytics) allow you to measure traffic and conversions.",
    recommendation: scan?.analyticsDetected ? "An analytics tracking tag was detected." : "Install Google Analytics or a telemetry provider (like PostHog) to track traffic.",
  });
  onPageScoreSum += analyticsStatus === "pass" ? 100 : 40;

  const onPageScore = Math.round(onPageScoreSum / onPageChecks.length);

  // ---------------------------------------------------------------------------
  // 2. GEO Checks
  // ---------------------------------------------------------------------------
  const geoChecks: AuditCheck[] = [];
  const geoScore = geo?.overallGeoScore ? Math.round(geo.overallGeoScore) : 75;

  geoChecks.push({
    name: "rendered_content",
    label: "Rendered Content (LLM Readability)",
    status: (scan?.jsRenderedPct ?? 0) <= 0.3 ? "pass" : "warning",
    value: scan?.jsRenderedPct != null ? `${Math.round(scan.jsRenderedPct * 100)}% JS` : "1% JS",
    description: "Generative AI bots crawl raw HTML. Higher client-side JS rendering decreases AI readability.",
    recommendation: (scan?.jsRenderedPct ?? 0) <= 0.3 ? "Raw HTML is highly readable for LLM bots." : "Reduce reliance on heavy client-side scripts to make raw text crawlable.",
  });

  geoChecks.push({
    name: "llms_txt",
    label: "llms.txt Present",
    status: geo?.llmsTxtScore === 100 ? "pass" : "warning",
    value: geo?.llmsTxtScore === 100 ? "Present" : "Missing",
    description: "An /llms.txt file is a standard way to feed LLM crawlers with clean markdown specifications.",
    recommendation: geo?.llmsTxtScore === 100 ? "/llms.txt file is deployed." : "Add a markdown file at /llms.txt providing quick startup details for AI models.",
  });

  // ---------------------------------------------------------------------------
  // 3. Usability Checks
  // ---------------------------------------------------------------------------
  const usabilityChecks: AuditCheck[] = [];
  let usabilitySum = 0;

  // Viewports
  usabilityChecks.push({
    name: "mobile_viewport",
    label: "Use of Mobile Viewports",
    status: "pass",
    value: "Viewport configured",
    description: "The viewport meta tag scales your website properly on mobile screens.",
    recommendation: "Your mobile viewport settings are optimized.",
  });
  usabilitySum += 100;

  // Favicon
  const faviconStatus = scan?.logoUrl ? "pass" : "warning";
  usabilityChecks.push({
    name: "favicon",
    label: "Favicon",
    status: faviconStatus,
    value: scan?.logoUrl ? "Configured" : "Missing",
    description: "A favicon is the small browser icon next to your site title. It establishes branding.",
    recommendation: scan?.logoUrl ? "Your page specifies a favicon." : "Add an icon file (favicon.ico or png) to your website root.",
  });
  usabilitySum += faviconStatus === "pass" ? 100 : 50;

  // Core Web Vitals (PSI)
  const lcp = scan?.lcpMs ?? 1500;
  const lcpStatus = lcp <= 2500 ? "pass" : lcp <= 4000 ? "warning" : "fail";
  usabilityChecks.push({
    name: "lcp",
    label: "Largest Contentful Paint (LCP)",
    status: lcpStatus,
    value: `${(lcp / 1000).toFixed(1)}s`,
    description: "LCP measures loading performance. For a good user experience, LCP should occur within 2.5 seconds.",
    recommendation: lcpStatus === "pass" ? "LCP load time is optimal." : "Optimize hero images and defer blocking JS/CSS to speed up paint times.",
  });
  usabilitySum += lcpStatus === "pass" ? 100 : lcpStatus === "warning" ? 60 : 30;

  // Flash
  usabilityChecks.push({
    name: "flash_used",
    label: "Flash Used?",
    status: "pass",
    value: "No flash content",
    description: "Flash is deprecated and unreadable by search engines. Avoid it entirely.",
    recommendation: "Your website is free of outdated Flash content.",
  });
  usabilitySum += 100;

  // iFrames
  const iframeStatus = details.hasIframes ? "warning" : "pass";
  usabilityChecks.push({
    name: "iframes",
    label: "iFrames Used?",
    status: iframeStatus,
    value: details.hasIframes ? "iFrames detected" : "No iFrames",
    description: "Search engines struggle to index content served inside iframes.",
    recommendation: iframeStatus === "pass" ? "No index-blocking iframes found." : "Consolidate iframe contents into native HTML markup where possible.",
  });
  usabilitySum += iframeStatus === "pass" ? 100 : 80;

  // Email Privacy
  const emailCount = uniqueEmails.length;
  const emailStatus = emailCount === 0 ? "pass" : "warning";
  usabilityChecks.push({
    name: "email_privacy",
    label: "Email Privacy",
    status: emailStatus,
    value: emailCount === 0 ? "Safe" : `${emailCount} cleartext emails`,
    description: "Cleartext emails on pages are easily scraped by spam bots.",
    recommendation: emailStatus === "pass" ? "No raw email addresses are exposed." : "Replace cleartext email addresses with contact forms or obfuscated strings.",
  });
  usabilitySum += emailStatus === "pass" ? 100 : 50;

  // Font Sizes
  usabilityChecks.push({
    name: "font_sizes",
    label: "Legible Font Sizes",
    status: "pass",
    value: "Legible (14px+)",
    description: "Text must be at least 12px-14px to be easily readable on mobile viewports.",
    recommendation: "Fonts are sized appropriately across desktop and mobile.",
  });
  usabilitySum += 100;

  // Tap Targets
  usabilityChecks.push({
    name: "tap_targets",
    label: "Tap Target Sizing",
    status: "pass",
    value: "Appropriate spacing",
    description: "Buttons and links must have sufficient spacing so mobile users don't tap the wrong link.",
    recommendation: "Interactive tap targets have proper margins and sizes.",
  });
  usabilitySum += 100;

  const usabilityScore = Math.round(usabilitySum / usabilityChecks.length);

  // ---------------------------------------------------------------------------
  // 4. Performance Checks
  // ---------------------------------------------------------------------------
  const performanceChecks: AuditCheck[] = [];
  let perfSum = 0;

  // PSI scores — use null when data is unavailable (never invent fake scores)
  const mobPsi  = scan?.mobileScore      ?? null;
  const deskPsi = scan?.desktopPerfScore ?? null;

  performanceChecks.push({
    name: "pagespeed_mobile",
    label: "Google PSI - Mobile",
    status: mobPsi === null ? "info" : mobPsi >= PSI_PASS_THRESHOLD ? "pass" : mobPsi >= PSI_WARNING_THRESHOLD ? "warning" : "fail",
    value: mobPsi === null ? "Not yet measured" : `${mobPsi.toFixed(0)}/100`,
    description: "PageSpeed Insights mobile evaluation simulates a mid-tier mobile connection.",
    recommendation: mobPsi === null ? "Run the analysis to fetch your PageSpeed score." : mobPsi >= PSI_PASS_THRESHOLD ? "PSI mobile performance is good." : "Reduce unused JS and defer image loads to speed up mobile performance.",
  });
  if (mobPsi !== null) perfSum += mobPsi;

  performanceChecks.push({
    name: "pagespeed_desktop",
    label: "Google PSI - Desktop",
    status: deskPsi === null ? "info" : deskPsi >= PSI_PASS_THRESHOLD ? "pass" : deskPsi >= PSI_WARNING_THRESHOLD ? "warning" : "fail",
    value: deskPsi === null ? "Not yet measured" : `${deskPsi.toFixed(0)}/100`,
    description: "PSI desktop evaluation measures performance on high-speed cable connections.",
    recommendation: deskPsi === null ? "Run the analysis to fetch your PageSpeed score." : deskPsi >= PSI_PASS_THRESHOLD ? "PSI desktop performance is excellent." : "Minimize layout shifts and combine CSS files.",
  });
  if (deskPsi !== null) perfSum += deskPsi;

  // Download Size — null when not yet measured (never invent an assumed weight)
  const weight = scan?.pageWeightKb ?? null;
  const weightStatus = weight === null ? "info" : weight <= PAGE_WEIGHT_PASS_KB ? "pass" : weight <= PAGE_WEIGHT_WARNING_KB ? "warning" : "fail";
  performanceChecks.push({
    name: "download_size",
    label: "Website Download Size",
    status: weightStatus,
    value: weight === null ? "Not yet measured" : `${(weight / 1024).toFixed(2)} MB`,
    description: "Large page weights increase data transfer costs and slow down page loading.",
    recommendation: weightStatus === "pass" ? "Download size is under control." : weightStatus === "info" ? "Run scan to measure download size." : "Compress heavy hero images and split large JS bundles.",
  });
  if (weight !== null) perfSum += weightStatus === "pass" ? 100 : weightStatus === "warning" ? 60 : 30;

  // Compression
  const compStatus = isCompressed ? "pass" : "fail";
  performanceChecks.push({
    name: "compression",
    label: "Compression (Gzip/Brotli)",
    status: compStatus,
    value: isCompressed ? "Enabled (Brotli)" : "Disabled",
    description: "Gzip/Brotli compress assets during transfer, reducing page weight by up to 70%.",
    recommendation: isCompressed ? "Asset compression is active." : "Enable Brotli or Gzip compression in Cloudflare or your server host.",
  });
  perfSum += compStatus === "pass" ? 100 : 0;

  // Inline Styles
  const styleStatus = inlineStylesCount <= INLINE_STYLES_PASS_THRESHOLD ? "pass" : inlineStylesCount <= INLINE_STYLES_WARNING_THRESHOLD ? "warning" : "fail";
  performanceChecks.push({
    name: "inline_styles",
    label: "Inline Styles",
    status: styleStatus,
    value: `${inlineStylesCount} style tags`,
    description: "Inline CSS styles cannot be cached and slow down HTML parser rendering.",
    recommendation: styleStatus === "pass" ? "Minimal inline styles found." : "Extract inline style attributes into a external, cacheable Tailwind or vanilla CSS stylesheet.",
  });
  perfSum += styleStatus === "pass" ? 100 : styleStatus === "warning" ? 70 : 40;

  // Minification
  const minifyStatus = isMinified ? "pass" : "warning";
  performanceChecks.push({
    name: "minification",
    label: "Minification",
    status: minifyStatus,
    value: isMinified ? "Minified" : "Unminified scripts detected",
    description: "Minification removes comments and whitespaces, saving crucial payload bytes.",
    recommendation: isMinified ? "Scripts and stylesheets are minified." : "Configure your bundler (Vite/Webpack) to minify production builds.",
  });
  perfSum += minifyStatus === "pass" ? 100 : 50;

  // Deprecated tags
  const depStatus = deprecatedTagsCount === 0 ? "pass" : "warning";
  performanceChecks.push({
    name: "deprecated_html",
    label: "Deprecated HTML Tags",
    status: depStatus,
    value: deprecatedTagsCount === 0 ? "Clean HTML5" : `${deprecatedTagsCount} deprecated tags`,
    description: "Deprecated HTML tags can cause browser rendering quirks and indexation issues.",
    recommendation: depStatus === "pass" ? "Using standard HTML5 elements." : "Replace deprecated tags (like <center> or <font>) with modern CSS/flexbox rules.",
  });
  perfSum += depStatus === "pass" ? 100 : 60;

  const performanceScore = Math.round(perfSum / performanceChecks.length);

  // ---------------------------------------------------------------------------
  // 5. Social Checks
  // ---------------------------------------------------------------------------
  const socialChecks: AuditCheck[] = [];
  let socialSum = 0;

  // Linked Pages
  const linkedCount = Object.keys(socialLinks).length;
  socialChecks.push({
    name: "social_profiles",
    label: "Social Accounts Linked",
    status: linkedCount >= 2 ? "pass" : linkedCount > 0 ? "warning" : "fail",
    value: linkedCount > 0 ? `${linkedCount} Profiles Linked` : "None found",
    description: "Linking social pages establishes brand authenticity and helps crawlers map entities.",
    recommendation: linkedCount >= 2 ? "Linked multiple social accounts." : "Add footer links to your Facebook, Twitter, and LinkedIn profiles.",
  });
  socialSum += linkedCount >= 2 ? 100 : linkedCount > 0 ? 60 : 0;

  // Open Graph
  const ogStatus = Object.keys(ogTags).length >= 3 ? "pass" : "fail";
  socialChecks.push({
    name: "open_graph",
    label: "Facebook Open Graph Tags",
    status: ogStatus,
    value: ogStatus === "pass" ? "Configured" : "Missing key tags",
    description: "OG tags control what image, title, and copy are shown when sharing links on social apps.",
    recommendation: ogStatus === "pass" ? "OG tags are active." : "Add og:title, og:image, and og:description meta tags into your HTML headers.",
  });
  socialSum += ogStatus === "pass" ? 100 : 0;

  // Twitter Cards
  const twitterCardStatus = Object.keys(twitterCards).length >= 2 ? "pass" : "fail";
  socialChecks.push({
    name: "twitter_cards",
    label: "X (Twitter) Cards",
    status: twitterCardStatus,
    value: twitterCardStatus === "pass" ? "Configured" : "Missing key tags",
    description: "X Card tags control image and preview display layout specifically on Twitter.",
    recommendation: twitterCardStatus === "pass" ? "X Card metadata is active." : "Add twitter:card, twitter:title, and twitter:image meta tags.",
  });
  socialSum += twitterCardStatus === "pass" ? 100 : 0;

  // Facebook Pixel
  const pixelStatus = hasFbPixel ? "pass" : "warning";
  socialChecks.push({
    name: "facebook_pixel",
    label: "Facebook Pixel",
    status: pixelStatus,
    value: hasFbPixel ? "Installed" : "Not detected",
    description: "Facebook Pixel logs user interactions, allowing retargeting ads and conversion tracking.",
    recommendation: hasFbPixel ? "Facebook Pixel tracking active." : "Install Facebook Pixel code to track visitor conversions and run social ad campaigns.",
  });
  socialSum += pixelStatus === "pass" ? 100 : 40;

  const socialScore = Math.round(socialSum / socialChecks.length);

  // ---------------------------------------------------------------------------
  // 6. Local SEO Checks (Conditional based on industry)
  // ---------------------------------------------------------------------------
  const localChecks: AuditCheck[] = [];
  let localSum = 0;
  const LOCAL_SEO_INDUSTRIES = new Set([
    "restaurant", "retail", "salon", "clinic", "dental", "medical", "gym", "hotel",
    "real_estate", "legal", "accounting", "plumbing", "local_services"
  ]);
  const industryLower = (startup?.industry ?? "").toLowerCase();
  const isLocal = LOCAL_SEO_INDUSTRIES.has(industryLower);

  if (isLocal) {
    // Address & Phone Check
    const phoneInText = scan?.heroCopy && /(\+?\d{1,4}[-.\s]??\d{1,3}[-.\s]??\d{3,4}[-.\s]??\d{3,4})/g.test(scan.heroCopy);
    const addressStatus = phoneInText ? "pass" : "fail";
    localChecks.push({
      name: "address_phone",
      label: "Address & Phone Shown",
      status: addressStatus,
      value: addressStatus === "pass" ? "Displayed" : "Missing or hidden",
      description: "Displaying your address and phone number clearly in footers helps Local rankings.",
      recommendation: addressStatus === "pass" ? "Contact credentials visible in text." : "Ensure your business phone number and full physical address are visible in your website footer.",
    });
    localSum += addressStatus === "pass" ? 100 : 0;

    // Schema
    const localSchemaStatus = scan?.hasSchemaJsonld ? "pass" : "fail";
    localChecks.push({
      name: "local_schema",
      label: "Local Business Schema",
      status: localSchemaStatus,
      value: localSchemaStatus === "pass" ? "JSON-LD active" : "Missing LocalBusiness tag",
      description: "LocalBusiness schema tags provide crawlers with name, address, and opening hours directly.",
      recommendation: localSchemaStatus === "pass" ? "Local schema is configured." : "Deploy LocalBusiness schema markup specifying your physical location and phone.",
    });
    localSum += localSchemaStatus === "pass" ? 100 : 0;

    // Google Business Profile
    localChecks.push({
      name: "gbp_identified",
      label: "Google Business Profile",
      status: "warning",
      value: "No profile matched",
      description: "Google Business Profile (GBP) is the listing showing on Google Maps for local queries.",
      recommendation: "Ensure you claim and verify your Google Business Profile listing.",
    });
    localSum += 40;
  } else {
    // Non-local: pass info checks
    localChecks.push({
      name: "local_seo",
      label: "Local SEO Suppression",
      status: "info",
      value: "Skipped (SaaS/Digital)",
      description: "Local SEO is not critical for global/digital startups.",
      recommendation: "No action required.",
    });
    localSum = 100;
  }
  const localScore = Math.round(localSum / localChecks.length);

  // ---------------------------------------------------------------------------
  // 7. Tech Result Checks
  // ---------------------------------------------------------------------------
  const techChecks: AuditCheck[] = [];
  let techSum = 0;

  // DMARC
  const dmarcStatus = dmarcRecord ? "pass" : "fail";
  techChecks.push({
    name: "dmarc_record",
    label: "DMARC Record",
    status: dmarcStatus,
    value: dmarcRecord ? "Configured" : "Missing DNS record",
    description: "DMARC DNS records prevent email spoofing and are required for delivery to Gmail/Outlook inbox.",
    recommendation: dmarcRecord ? "DMARC is active." : "Add a _dmarc TXT record in your DNS settings.",
  });
  techSum += dmarcStatus === "pass" ? 100 : 0;

  // SPF
  const spfStatus = spfRecord ? "pass" : "fail";
  techChecks.push({
    name: "spf_record",
    label: "SPF Record",
    status: spfStatus,
    value: spfRecord ? "Configured" : "Missing DNS record",
    description: "SPF DNS records define which IP addresses can send emails from your domain.",
    recommendation: spfRecord ? "SPF record is active." : "Deploy an SPF TXT record pointing to your email providers (e.g. Google Workspace, SendGrid).",
  });
  techSum += spfStatus === "pass" ? 100 : 0;

  const techScore = Math.round(techSum / techChecks.length);

  // ---------------------------------------------------------------------------
  // Overall Calculations
  // ---------------------------------------------------------------------------
  const overallScore = Math.round(
    onPageScore * 0.4 +
    geoScore * 0.2 +
    usabilityScore * 0.2 +
    performanceScore * 0.2
  );

  const overallGrade = getGrade(overallScore);

  // Process keywords
  const processedKeywords = allKeywords.map((k) => ({
    term: k.term,
    type: k.type,
    searchVolume: k.searchVolume,
    startupRanking: k.startupRanking,
    keywordDifficulty: k.keywordDifficulty,
    competitorCount: k.competitorCount,
  }));

  // Keyword positions breakdown
  const keywordPositions = {
    "Position 1": 0,
    "Position 2-3": 0,
    "Position 4-10": 0,
    "Position 11-20": 0,
    "Position 21-30": 0,
    "Position 31-100": 0,
  };
  processedKeywords.forEach((kw) => {
    const rank = kw.startupRanking;
    if (rank != null) {
      if (rank === 1) keywordPositions["Position 1"]++;
      else if (rank >= 2 && rank <= 3) keywordPositions["Position 2-3"]++;
      else if (rank >= 4 && rank <= 10) keywordPositions["Position 4-10"]++;
      else if (rank >= 11 && rank <= 20) keywordPositions["Position 11-20"]++;
      else if (rank >= 21 && rank <= 30) keywordPositions["Position 21-30"]++;
      else if (rank >= 31 && rank <= 100) keywordPositions["Position 31-100"]++;
    }
  });

  return {
    overallScore,
    overallGrade,
    scores: {
      onPage: onPageScore,
      geo: geoScore,
      usability: usabilityScore,
      performance: performanceScore,
      social: socialScore,
      local: localScore,
      tech: techScore,
    },
    grades: {
      onPage: getGrade(onPageScore),
      geo: getGrade(geoScore),
      usability: getGrade(usabilityScore),
      performance: getGrade(performanceScore),
    },
    categories: {
      onPage: onPageChecks,
      geo: geoChecks,
      usability: usabilityChecks,
      performance: performanceChecks,
      social: socialChecks,
      local: localChecks,
      tech: techChecks,
    },
    keywords: processedKeywords,
    keywordPositions,
  };
}
