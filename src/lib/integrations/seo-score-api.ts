/**
 * Integration client for seoscoreapi.com
 * Fetches real-time SEO audit metrics, grade, issues, and priorities for a given website URL.
 */

export interface SeoScoreAuditResult {
  url: string;
  score: number;
  grade: string;
  responseTime?: string;
  audit?: {
    meta?:          { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    technical?:     { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    social?:        { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
    accessibility?: { score?: number; checks?: Array<{ name: string; status: string; value: unknown; score: number }> };
  };
  /** Real API uses: severity ("high"|"medium"|"low"), issue (title), fix (description) */
  priorities?: Array<{ title?: string; description?: string; impact?: string; category?: string; severity?: string; issue?: string; fix?: string }>;
  aiReadability?: Record<string, unknown>;
  coreWebVitals?: Record<string, unknown>;
  raw?: unknown;
}

export async function fetchSeoScoreAudit(url: string): Promise<SeoScoreAuditResult | null> {
  const apiKey = process.env.SEO_SCORE_API_KEY || "ssa_25c0f2d77d1c8cba71092f0c09c5af8dc2d7e5945f1a67d6";
  if (!apiKey) {
    console.warn("[seo-score-api] SEO_SCORE_API_KEY is not set.");
    return null;
  }

  try {
    const formattedUrl = url.startsWith("http") ? url : `https://${url}`;
    
    // Validate URL can be parsed
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(formattedUrl);
    } catch {
      console.warn(`[seo-score-api] Invalid URL format: ${url}`);
      return null;
    }

    // Skip localhost, IPs, and known-unsupported patterns
    if (
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname.startsWith("127.") ||
      parsedUrl.hostname.startsWith("192.168.") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(parsedUrl.hostname)
    ) {
      console.warn(`[seo-score-api] Skipping local/IP URL: ${url}`);
      return null;
    }

    const endpoint = `https://seoscoreapi.com/audit?url=${encodeURIComponent(parsedUrl.toString())}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // Handle rate-limit gracefully
      if (res.status === 429 || errText.includes("Daily limit") || errText.includes("limit exceeded")) {
        console.warn(`[seo-score-api] Daily rate limit hit for ${url} — using cached/null result.`);
        return null;
      }
      console.warn(`[seo-score-api] API returned status ${res.status} for ${url}: ${errText.slice(0, 200)}`);
      return null;
    }

    // Handle rate-limit in JSON body (some APIs return 200 with error body)
    const data = await res.json();
    if (data.detail?.includes?.("limit") || data.error?.includes?.("limit")) {
      console.warn(`[seo-score-api] Rate limit in response body for ${url}: ${data.detail || data.error}`);
      return null;
    }

    // The API returns top-level: score_summary.score, score_summary.grade
    // OR directly: data.score, data.grade — normalise both shapes.
    const score = data.score ?? data.score_summary?.score ?? 70;
    const grade = data.grade ?? data.score_summary?.grade ?? "B";

    // Normalise priorities — API uses { severity, issue, fix, category } shape
    const rawPriorities: Array<Record<string, string>> = [
      ...(Array.isArray(data.priorities) ? data.priorities : []),
      ...(Array.isArray(data.ai_readability?.recommendations) ? data.ai_readability.recommendations : []),
    ];
    const priorities = rawPriorities.slice(0, 8).map(p => ({
      title:       p.issue   || p.title       || "SEO Issue",
      description: p.fix     || p.description || "",
      impact:      p.severity || p.impact      || "medium",
      category:    p.category || "",
    }));

    return {
      url:          data.url || parsedUrl.toString(),
      score,
      grade,
      responseTime: data.response_time,
      audit:        data.audit,
      priorities,
      aiReadability: data.ai_readability,
      coreWebVitals: data.core_web_vitals,
      raw:          data,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[seo-score-api] Timeout fetching audit for ${url}`);
      return null;
    }
    console.error("[seo-score-api] Error fetching SEO audit:", err);
    return null;
  }
}
