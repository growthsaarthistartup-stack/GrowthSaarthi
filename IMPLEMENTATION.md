# GrowthSaarthi — Implementation Reference

> **Stack:** Next.js 15 (App Router) · Drizzle ORM · Neon Postgres · OpenRouter LLM · Zod · TypeScript

---

## 1. Architecture

```
Browser (Next.js Client)
    ↓  fetch()
App Router API Routes  (/app/api/*)
    ↓  import
Orchestrator / Agents  (/lib/agents/*, /lib/orchestrator.ts)
    ↓  runAgent()
Agent Runner           (/lib/agent-runner.ts)   ← single LLM gateway
    ↓  OpenRouter REST
OpenRouter API         (openrouter/auto → best free model at runtime)
    ↓  Zod schema validation + retry
Drizzle ORM            (/lib/db/)
    ↓  @neondatabase/serverless
Neon Postgres          (21 tables, append-only fact model)
```

**Key design rules:**
- Every LLM call goes through `runAgent()` — no other file calls OpenRouter.
- DB tables are **append-only facts** (mutations only on startups, integrations, brand_voices).
- Every row: ULID `id` + `idempotency_key` → re-running any agent on same day is safe.
- One agent failure never blocks others — `Promise.allSettled` in onboarding route.

---

## 2. Auth (Passwordless OTP)

```
POST /api/auth/send-otp     → generate 6-digit OTP, save to otps table (10min TTL),
                              send HTML email via Resend, always log to server console
POST /api/auth/verify-otp   → validate OTP, delete it, find-or-create user row,
                              create sessions row (ULID = cookie token)
GET  /api/auth/me           → read session cookie → return {id, email}
POST /api/auth/logout       → delete session row, clear cookie
```

Files: `send-otp/route.ts`, `verify-otp/route.ts`, `me/route.ts`, `logout/route.ts`, `lib/auth.ts`

**Resend free tier:** Only sends to the verified owner email. OTP is always printed in `npm run dev` terminal. Add a Resend custom domain to lift restriction.

---

## 3. Onboarding Pipeline

```
POST /api/onboarding { startupName, websiteUrl, stage, primaryGoal }

1. INSERT startups row (ULID)
2. Promise.allSettled([
     scrapeWebsite(startupId, url),       // Website Scraper
     discoverCompetitors(startupId),      // Competitor Agent
     runSeoIngestion(startupId, domain),  // SEO Agent (skips if no GSC)
   ])
3. runSeoAnalysis(startupId)             → Recommendations written to DB
4. calculateHealthScore(startupId, stage)
5. rankRecommendations(startupId)
6. build30DayPlan(rankedRecs, startupId)
7. Return { startupId, scores, gaps, opportunities, plan }
```

Fallback: `DATABASE_URL` missing → realistic mock data. Empty plan → one placeholder task.

---

## 4. Agents

### Agent Runner (`/lib/agent-runner.ts`)
Single LLM gateway. All agents go through `runAgent()`.

```
runAgent(contract, context):
  - Calls OpenRouter with response_format: json_schema (Zod schema → JSON Schema)
  - Strips markdown fences from response
  - Zod-validates output
  - On failure: retry up to maxRetries (default 2)
  - On last retry: step down to fallbackModel
  - On all exhausted: throw AgentHardFailureError
  - Round-robin across OPENROUTER_API_KEY1, KEY2, KEY
```

### Model Routes (`/lib/models.ts`)
```
Primary:  openrouter/auto          → best free model at runtime (tested: gpt-5.6-sol)
Fallback: google/gemini-2.5-flash:free
All 9 agent roles use the same pair.
```

### Website Scraper (`/lib/agents/website-scraper.ts`) — No LLM
```
1. Check daily idempotency → return existing if found
2. Playwright headless Chrome → fetch+cheerio fallback on error
3. Parse: title, meta description, H1, hero copy, CTA texts
4. Tech-stack fingerprinting: 12 signals (next.js, wordpress, stripe, GA4…)
5. Google PageSpeed Insights (free) → LCP, CLS, mobile score
6. Write WebsiteScan row
```

### Competitor Agent (`/lib/agents/competitor-agent.ts`) — 1 LLM call
```
1. Weekly idempotency check (one SerpAPI search per startup/week)
2. SerpAPI: "best {industry} tools site:g2.com OR site:producthunt.com"
3. Extract candidate URLs (G2/PH slug regex + generic domain)
4. Scrape each candidate (fetch + cheerio): hero copy, H1, pricing, features
5. Embed startup text + candidates via @xenova/all-MiniLM-L6-v2 (local, free)
6. Cosine similarity ≥ 0.72 → confirmed competitor → write Competitor row
7. runAgent(POSITIONING_GAP_AGENT) → gaps + opportunities (not stored separately yet)
```

### SEO Ingestion Agent (`/lib/agents/seo-agent.ts`) — No LLM
```
1. Check for active GSC integration → graceful skip if none
2. Weekly idempotency
3. Google Webmasters API: last 28 days, by query+page, 100 rows
4. Write Keyword rows: ranking ≤ 10 → "owned", else "gap"
   impressions ≈ search volume proxy
```

### SEO Analysis Agent (`/lib/agents/seo-analysis-agent.ts`) — 1 LLM call per issue
```
1. Load latest WebsiteScan
2. fetchSeoScoreAudit(scan.url) → SEOScoreAPI live audit

Issue detection (pure math, no LLM):
  low_overall_seo_score    → score < 80 or grade C/D/F
  missing_llms_txt         → ai_readability.llms_txt === false
  missing_open_graph       → social.checks open_graph ≠ pass
  missing_meta_description → scan.metaDescription null
  broken_h1                → scan.h1 null
  slow_lcp                 → scan.lcpMs > 4000
  missing_sitemap          → !scan.hasSitemap
  api_audit_priority       → top 2 from SEOScoreAPI priorities array
  keyword_gap_high_volume  → keywords type=gap AND volume > 500

For each issue:
  a. Idempotency check (today + issue type) → skip if done today
  b. generateSeoRecommendation() → runAgent() → { title, description, evidenceFactId }
  c. writeRecommendation() → INSERT with impact/effort/priority scores
```

SEO_WEIGHTS (hardcoded):
```
missing_sitemap:      impact=0.5, effort=0.05
missing_llms_txt:     impact=0.85, effort=0.1
api_audit_priority:   impact=0.95, effort=0.4
slow_lcp:             impact=0.8, effort=0.6
```

### Blog Draft Agent (`/lib/agents/blog-draft-agent.ts`)
```
1. Load BrandVoice (tone, examples, avoid list) — defaults if none
2. runAgent → { title, content(min 200 chars), metaTitle, metaDesc }
3. Write ContentDraft: type="blog", status="pending_approval",
   content = JSON.stringify({ title, content, metaTitle, metaDesc })
4. Daily idempotency per recommendation
```

### Social Draft Agent (`/lib/agents/social-draft-agent.ts`)
```
Same pattern as blog. Output: { hook, body, hashtags[], callToAction }
ContentDraft type = "linkedin" (or per-platform)
```

### Topic Suggest Agent (`/lib/agents/topic-suggest-agent.ts`)
```
Input: WebsiteScan { title, h1, metaDescription, techStack[] }
Output: { suggestions: [{ title, keywords[], reason }] }  — exactly 3 topics
Model: blog_final_draft route
Called by: POST /api/content-drafts/suggest-topics
```

---

## 5. SEOScoreAPI Integration (`/lib/integrations/seo-score-api.ts`)

```
GET https://seoscoreapi.com/audit?url={url}
Authorization: Bearer {SEO_SCORE_API_KEY}

Field normalisation (real API shape vs what we expose):
  data.score / data.score_summary?.score → score
  data.grade / data.score_summary?.grade → grade
  priorities: [...data.priorities, ...data.ai_readability.recommendations]
    .map({ severity→impact, issue→title, fix→description })
    .slice(0, 8)

Returns null gracefully when:
  - localhost / IP address URL
  - HTTP 429 or body contains "Daily limit exceeded"
  - AbortController timeout (15s)

Free plan: 2 audits/day
```

---

## 6. Scoring Engine

### Health Score (`/lib/scoring/health-score.ts`) — Pure math, no LLM

```
scoreMetric(value, good, bad, invert?):
  null/undefined → 0.5 (neutral, never 0)
  invert=true → negates all three values
  returns linear interpolation [0, 1]

weightedAvg(values, weights?):
  equal weights when no map given
  empty → 0.5

HealthScore:
  technical  = weightedAvg(lcp, mobileScore, hasSitemap, techStackDiversity)
  validation = weightedAvg(metaScore, h1Score, wordCountScore, ctaScore)
  growth     = weightedAvg(keywordScore, competitorScore, conversionScore)
  overall    = 0.4 * technical + 0.35 * validation + 0.25 * growth
```

### Recommendation Engine (`/lib/scoring/recommendation-engine.ts`)

```
writeRecommendation():
  priorityScore = impactScore / (effortScore + 0.01)
  enforces evidenceFactIds.length ≥ 1
  INSERT onConflictDoNothing

rankRecommendations(startupId):
  SELECT pending recommendations → sort by priorityScore DESC
  Goal weight boost:
    acquisition → seo/content categories boosted
    retention   → churn/email categories boosted

calculateImpact({ category, keywordVolume? }):
  base: seo=0.3, content=0.35, landing_page=0.4, churn=0.6
  +0.1 if volume > 1000, +0.05 if > 500
```

### Plan Sequencer (`/lib/scoring/plan-sequencer.ts`)

```
DEPENDENCIES (spec §6):
  paid_ads            → [landing_page_copy, conversion_tracking]
  product_hunt_launch → [landing_page_copy, meta_description]
  seo_blog_posts      → [tech_seo_fixes]
  linkedin_content    → [brand_voice_defined]

build30DayPlanPure(ranked, completed):
  for week in [1,2,3,4]:
    for rec not yet assigned:
      deps satisfied if: dep in completed OR dep in prev week's categories
      assign rec → stop when week has 3

build30DayPlan(ranked, startupId):
  loads completed = categories with status executed|approved
  delegates to pure function
```

---

## 7. Trust Ladder & Execution Gate

### Trust Ladder (`/lib/trust-ladder.ts`)

```
computeTrustLevel(approvedCount, totalCount):
  rate = approved / max(total, 1)
  ≥ 15 approved AND rate > 0.8 → level 4 (autonomous)
  ≥  5 approved AND rate > 0.7 → level 3 (execute + confirm)
  ≥  2 approved               → level 2 (draft, don't send)
  else                         → level 1 (suggest only)

getTrustLevel(startupId, category):
  reads feedbackSignals filtered by startup + category
```

### Execution Gate (`/lib/execution-gate.ts`)

```
IRREVERSIBLE = { email_customers, change_pricing, publish_content, delete_data }
AUTO_SAFE    = { seo_metadata, monitoring_report }

executeAction(startupId, category, actionRisk, actionFn):
  trust = getTrustLevel(startupId, category)
  IRREVERSIBLE + trust < 3 → throw ExecutionBlocked
  trust == 4 AND AUTO_SAFE → run actionFn() directly ("direct")
  else → return { dispatched: "confirmation" }   ← draft queued

NOTE: content_blog / content_social are NEVER in AUTO_SAFE.
      Founders always review content, even at trust level 4 (by spec design).
```

---

## 8. API Routes Summary

| Route | Method | What it does |
|---|---|---|
| `/api/auth/send-otp` | POST | OTP email |
| `/api/auth/verify-otp` | POST | Validate OTP → session |
| `/api/auth/me` | GET | Session user |
| `/api/auth/logout` | POST | Clear session |
| `/api/onboarding` | POST | Full agent pipeline |
| `/api/recommendations` | GET | DB recs for startupId |
| `/api/recommendations/[id]/approve` | POST | ExecutionGate → draft agent |
| `/api/recommendations/[id]/edit` | POST | Update + FeedbackSignal |
| `/api/recommendations/[id]/ignore` | POST | Status → ignored |
| `/api/competitors` | GET | DB competitors for startupId |
| `/api/content-drafts` | GET | Drafts filtered by type |
| `/api/content-drafts/suggest-topics` | POST | LLM topic ideas from scan |
| `/api/content-drafts/publish` | POST | Mark published + social rows |
| `/api/seo-audit` | GET | SEOScoreAPI proxy |
| `/api/integrations` | GET/POST | OAuth integration upsert |
| `/api/cron/weekly` | GET | Runs daily cycle for all startups |

---

## 9. Database Schema (21 tables)

**Auth:** users, otps, sessions

**Core facts (append-only):**
- startups (mutable root) — name, url, stage, primary_goal, industry
- website_scans — url, title, meta_description, h1, hero_copy, tech_stack[], lcp_ms, has_sitemap
- competitors — name, url, hero_copy, positioning_angle, pricing_model, features[]
- competitor_scans — weekly snapshot, change_detected flag
- keywords — term, search_volume, startup_ranking, type(owned|gap|opportunity)
- metrics — type, value, date, source
- recommendations — category, title, description, evidence_fact_ids[], impact/effort/priority scores, status, trust_level_required
- content_drafts — type, content(JSON string), status, published_url
- feedback_signals — action(approved|edited|ignored), edit_delta_chars, category
- telemetry_events — event, metadata_json
- agent_failures — agent_name, error_message, context
- alerts — metric_type, z_score, severity, channel, message, acknowledged
- outcome_records — before_value, after_value, change_pct, recommendation_worked

**Mutable:** integrations, brand_voices

**Schema-ready (agents deferred):** customers, market_signals, stripe_events

**Enums:** startup_stage, primary_goal, metric_type, rec_status, content_type, content_status, integration_type, feedback_action, keyword_type, alert_severity, alert_channel, telemetry_event

---

## 10. Dashboard (`/app/dashboard/page.tsx`)

### State machine
```
createState: "input" → "step1" → "step2" → "step3" → "running" → "ready"
```

### Tab live-data fetching (useEffect on activeTab change)
```
competitors → GET /api/competitors?startupId
seo         → [GET /api/recommendations, GET /api/seo-audit?url]
blogs       → GET /api/content-drafts?startupId&type=blog
socials     → GET /api/content-drafts?startupId&type=social
```

### Approve task flow
```
recId starts with "rec_" → demo modal (no API call)
real ULID →
  POST /api/recommendations/{recId}/approve { startupId }
  data.draftId? → fetch draft → parse JSON content → show modal
  dispatched="blocked"? → show trust-level error
  else → show queued message
```

### Integrations tab
Connect/disconnect LinkedIn, YouTube, Facebook, Instagram, Twitter via `POST /api/integrations`.

---

## 11. Environment Variables

```bash
DATABASE_URL            # Neon Postgres
OPENROUTER_API_KEY1     # Primary (round-robin)
OPENROUTER_API_KEY2     # Secondary
OPENROUTER_API_KEY      # Fallback
SEO_SCORE_API_KEY       # seoscoreapi.com (2 free/day)
SERPAPI_KEY             # Competitor search
RESEND_API_KEY          # OTP emails
CRON_SECRET             # /api/cron/weekly auth
GOOGLE_CLIENT_ID        # GSC OAuth (optional)
GOOGLE_CLIENT_SECRET    # GSC OAuth (optional)
```

---

## 12. Idempotency

```
buildIdempotencyKey(namespace, startupId, variant, window):
  "WebsiteScan:01KY...:playwright:2026-07-25"   → daily
  "CompetitorScan:01KY...:serpapi:2026-W30"      → weekly
  "BlogDraft:01KY...:01KY39SZ...:2026-07-25"    → daily per rec

All inserts: .onConflictDoNothing() — re-running any agent same day is safe.
```

---

## 13. Monitoring

`/lib/monitoring/anomaly-detector.ts`:
- Z-score on last 30 metric rows per startup
- `|z| > 2.0` → write alerts row + optional Resend email
- `/api/cron/weekly` triggers this for all startups

---

## 14. Known Constraints

| Constraint | Reason |
|---|---|
| Content never auto-published | `publish_content` ∉ AUTO_SAFE — requires explicit code change |
| Competitor agent needs real SaaS URL | Threshold 0.72 → `example.com` returns 0 matches (expected) |
| SEOScoreAPI 2 req/day | Free plan; dashboard shows DB recs when limit hit |
| Playwright needs `npx playwright install` | Falls back to fetch+cheerio automatically |
| Resend OTP to verified email only | Free tier; OTP always in server console as fallback |
| No keyword gaps without GSC | SEO agent skips gracefully; SEOScoreAPI still powers recs |
