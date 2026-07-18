# LaunchPilot — Agent Architecture Blueprint
## The Engineering Spec — Read This Fully Before Writing Any Code

---

> [!IMPORTANT]
> This document is the single source of truth for building LaunchPilot. It is written to be handed directly to a coding agent (or a human engineer) as the build spec. Every entity, agent, scoring formula, and trust rule here is meant to be implemented exactly as written — not reinterpreted. Where an item is intentionally out of scope for the first release, it says so explicitly and gives it a schema slot so adding it later is a flag flip, not a redesign.

---

## Table of Contents
0. [Build Rules for the Implementing Agent](#0-build-rules-for-the-implementing-agent)
1. [System Overview & Data Flow](#1-system-overview--data-flow)
2. [Agent Contract Layer](#2-agent-contract-layer)
3. [Agent Taxonomy & Exact Logic](#3-agent-taxonomy--exact-logic)
4. [Knowledge Graph — Schema & Write Rules](#4-knowledge-graph--schema--write-rules)
5. [Idempotency — Concrete Mechanism](#5-idempotency--concrete-mechanism)
6. [Recommendation Engine — Scoring Logic](#6-recommendation-engine--scoring-logic)
7. [Trust Ladder & Execution Gate](#7-trust-ladder--execution-gate)
8. [Evaluation Harness](#8-evaluation-harness)
9. [Model Routing & Cost Control](#9-model-routing--cost-control)
10. [Telemetry — Product Success Metrics](#10-telemetry--product-success-metrics)
11. [Free APIs vs Build-From-Scratch](#11-free-apis-vs-build-from-scratch)
12. [Onboarding Pipeline — Step-by-Step Logic](#12-onboarding-pipeline--step-by-step-logic)
13. [Continuous Monitoring Scheduler](#13-continuous-monitoring-scheduler)
14. [Feedback Loop Architecture](#14-feedback-loop-architecture)
15. [Build Order & MVP Checklist](#15-build-order--mvp-checklist)
16. [Key Engineering Principles](#16-key-engineering-principles)

---

## 0. Build Rules for the Implementing Agent

If you (an AI coding agent or an engineer) are building this from scratch, follow this order and these constraints — they are load-bearing, not suggestions:

1. **Build Section 2 (Agent Contract Layer) and Section 5 (Idempotency) before writing a single ingestion or analysis agent.** Every agent in this document assumes both exist. Retrofitting them later means touching every agent twice.
2. **Every entity in Section 4 gets created in the schema on day one**, even the ones whose ingestion agent is `status: deferred`. Schema-first. Do not wait until a feature ships to give it a table.
3. **Every LLM call goes through `run_agent()` (Section 2). There is no other way to call a model in this codebase.** No inline `llm.generate()` calls anywhere, ever — this is what makes retries, fallback models, schema validation, and citation-checking automatic instead of bespoke per agent.
4. **Every side-effecting execution action goes through `ExecutionGate.execute_action()` (Section 7). There is no other way to publish, send, or change customer-facing state.** This is what makes the trust ladder unbypassable.
5. **Don't use an LLM where deterministic code is more reliable and cheaper** — tech-stack fingerprinting, keyword clustering, health-score math, and idempotency-key construction are all pure functions with zero model calls. Reach for a model only for genuine reasoning (does this competitor actually compete with us?) or generation (write this blog post).
6. **Ship the eval harness (Section 8) alongside the first agent, not after.** No prompt change reaches production without a golden-set pass rate ≥ 0.85.

---

## 1. System Overview & Data Flow

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            LAUNCHPILOT ENGINE                             │
│                                                                           │
│  Active in MVP                          Schema-ready, agent deferred     │
│  ┌─────────┐ ┌────────┐ ┌────────┐      ┌────────────┐ ┌──────────────┐ │
│  │ Website │ │GA4/GSC │ │ Stripe │      │ Market/TAM │ │ Customer FB  │ │
│  │(scrape) │ │ (API)  │ │(webhook│      │            │ │              │ │
│  └────┬────┘ └───┬────┘ └───┬────┘      └────────────┘ └──────────────┘ │
│       │          │          │                                            │
│       └──────────┴──────────┘   ┌──────────────────────┐                 │
│               │                 │ Competitors (SerpApi) │                 │
│               │                 └──────────┬───────────┘                 │
│               ▼                            │                             │
│    ┌────────────────────────────────────────┐                            │
│    │            INGESTION AGENTS              │  typed, schema-bound,    │
│    │                                          │  retry + fallback model  │
│    └───────────────────┬──────────────────────┘                          │
│                         │ idempotency-keyed, timestamped fact writes      │
│                         ▼                                                 │
│    ┌────────────────────────────────────────┐                            │
│    │            KNOWLEDGE GRAPH               │  append-only, versioned  │
│    └───────────────────┬──────────────────────┘                          │
│                         │ reads                                          │
│                         ▼                                                 │
│    ┌────────────────────────────────────────┐                            │
│    │            ANALYSIS AGENTS                │  decomposed:            │
│    │                                          │  extract → reason →      │
│    │                                          │  generate, per-step model│
│    └───────────────────┬──────────────────────┘                          │
│                         ▼                                                 │
│    ┌────────────────────────────────────────┐                            │
│    │         RECOMMENDATION ENGINE             │  impact × confidence /  │
│    │                                          │  effort, goal-weighted   │
│    └───────────────────┬──────────────────────┘                          │
│                         │                                                 │
│         ┌───────────────┼────────────────────┐                           │
│         ▼               ▼                    ▼                           │
│  Daily Briefing   30-Day Plan         Founder UI (Approve/Edit/Ignore)   │
│                                              │                            │
│                             ┌─────────────────▼─────────────────┐        │
│                             │        EXECUTION AGENTS             │       │
│                             │  (blog + social drafts, SEO fixes,  │       │
│                             │   ALWAYS through ExecutionGate)     │       │
│                             └─────────────────┬─────────────────┘        │
│                                                │                          │
│                             ┌─────────────────▼─────────────────┐        │
│                             │        FEEDBACK WRITER              │       │
│                             │   (outcome + telemetry → graph)     │       │
│                             └────────────────────────────────────┘       │
│                                                                           │
│   Cutting across every layer: EVAL HARNESS · MODEL ROUTER · TELEMETRY    │
└───────────────────────────────────────────────────────────────────────────┘
```

### Core Design Principle: Append-Only Knowledge Graph
**Never mutate a fact. Always insert a new timestamped fact.** This is what makes "before vs after" comparisons, full audit trails, and safe rollback possible. Enforced at the repository layer (Section 4), not by convention.

---

## 2. Agent Contract Layer

Every agent — ingestion, analysis, or execution — is defined as a typed contract, never a bare prompt string. This is the single most important structural decision in this codebase: it's what makes retries, fallback models, schema validation, and citation-checking uniform instead of reimplemented per agent.

```python
from pydantic import BaseModel, ValidationError
from typing import Literal

class AgentContract(BaseModel):
    name: str
    model: str                              # OpenRouter model id — Section 9
    system_prompt: str
    output_schema: type[BaseModel]          # every agent's output is schema-validated
    max_retries: int = 2
    fallback_model: str | None = None       # stepped down to on repeated failure
    tools: list[dict] = []                  # JSON-schema tool defs the model may call
    status: Literal["active", "deferred"] = "active"   # orchestrator skips non-active agents entirely

async def run_agent(contract: AgentContract, context: dict) -> BaseModel:
    if contract.status != "active":
        raise AgentNotActive(contract.name)

    model = contract.model
    for attempt in range(contract.max_retries + 1):
        raw = await call_llm(
            model=model,
            system=contract.system_prompt,
            messages=[{"role": "user", "content": render(context)}],
            tools=contract.tools,
            response_format={"type": "json_schema", "schema": contract.output_schema.model_json_schema()},
        )
        try:
            parsed = contract.output_schema.model_validate_json(raw)
            if hasattr(parsed, "evidence_fact_id"):
                assert graph_repo.fact_exists(parsed.evidence_fact_id), "Cited fact does not exist"
            return parsed
        except (ValidationError, AssertionError) as e:
            log_agent_failure(contract.name, attempt, e)
            if attempt == contract.max_retries and contract.fallback_model:
                model = contract.fallback_model     # step down, don't retry the same model blindly
                continue
            if attempt == contract.max_retries:
                raise AgentHardFailure(contract.name, e)
```

**Failure isolation** — a single failed agent must never take down a report:
```python
async def run_ingestion_stage(startup_id, agents: list[AgentContract]):
    results = {}
    for agent in [a for a in agents if a.status == "active"]:
        try:
            results[agent.name] = await run_agent(agent, get_context(startup_id))
        except AgentHardFailure as e:
            results[agent.name] = None
            write_fact("AgentFailure", {"startup_id": startup_id, "agent": agent.name, "error": str(e)})
            # does NOT re-raise — one agent's failure never blocks the others
    return results
```

---

## 3. Agent Taxonomy & Exact Logic

### 3.1 Orchestrator Agent
The brain that schedules everything else. No direct external data access — reads only from the graph and config.

```python
class Orchestrator:
    def run_daily_cycle(startup_id):
        stale_sources = get_stale_sources(startup_id, current_time)
        active_agents = [a for a in stale_sources if a.status == "active"]

        results = await run_ingestion_stage(startup_id, active_agents)

        new_facts = get_facts_since(last_analysis_timestamp)
        analysis_results = await analyse(new_facts)

        ranked_actions = recommendation_engine.rank(startup_id)
        write_briefing(startup_id, ranked_actions[0])
        update_plan(startup_id, ranked_actions)
        check_alerts(startup_id)
```
Idempotency is guaranteed by every downstream `write_fact()` call using an idempotency key (Section 5) — running this twice in a day produces identical graph state, not duplicate rows.

### 3.2 Website Scraper Agent

**Trigger:** onboarding (once) + daily thereafter.

```python
async def scrape_website(url: str) -> WebsiteScan | None:
    try:
        page_data = await playwright_fetch(url, timeout_ms=15000)
    except TimeoutError:
        write_fact("AgentFailure", {"agent": "website_scraper", "url": url, "reason": "timeout"})
        return None
    except BotBlockedError:
        page_data = await static_fetch_fallback(url)   # partial data beats no data
        write_fact("ScanDegraded", {"url": url, "reason": "bot_blocked", "method": "static_fallback"})
    return parse_scan(page_data)
```

Pulls: DOM (title, meta description, headings, copy, CTAs), response headers (tech fingerprint), robots.txt, sitemap.xml, full-page screenshot, Lighthouse Core Web Vitals (LCP, CLS, FID/INP, TTFB), broken-link check.

**Tech-stack fingerprinting — pure pattern matching, no LLM:**
```python
FINGERPRINTS = {
    "next.js": ["__NEXT_DATA__", "_next/static"],
    "wordpress": ["wp-content", "wp-json"],
    "shopify": ["cdn.shopify.com", "Shopify.theme"],
    "webflow": ["webflow.com", "data-wf-page"],
    "react": ["react-root", "__reactFiber"],
    "stripe": ["js.stripe.com"],
    "google-analytics": ["gtag", "UA-", "G-"],
}

def detect_tech(html_content, headers):
    return [tech for tech, signals in FINGERPRINTS.items()
            if any(s in html_content for s in signals)]
```

**Schema written to graph:**
```json
{
  "entity": "WebsiteScan", "startup_id": "...", "timestamp": "ISO8601", "url": "...",
  "title": "...", "meta_description": "...", "h1": "...", "word_count": 847,
  "cta_texts": ["Start free trial", "Book a demo"], "tech_stack": ["Next.js", "Vercel", "Stripe"],
  "lcp_ms": 2400, "cls_score": 0.12, "broken_links": [], "has_sitemap": true,
  "robots_allows_all": true, "screenshot_path": "blobs/startup123/scan_20260714.png"
}
```

### 3.3 SEO Agent
Uses Google Search Console API (free, OAuth) for real click/impression data, DataForSEO or the free-stack alternative (Section 11) for rankings.

```python
def run_seo_ingestion(startup_id, domain):
    rankings = get_rankings(domain, limit=100)
    if gsc_connected(startup_id):
        gsc_data = gsc_api.query(domain, dimensions=["query", "page"], date_range="last_28_days")

    for comp in get_competitors(startup_id):
        comp_keywords = get_rankings(comp.domain, limit=100)
        gaps = comp_keywords - rankings
        for k in gaps:
            write_fact("KeywordGap", {"keyword": k, "competitor": comp, "gap_volume": k.search_volume})

    check_canonical_tags(domain)
    check_structured_data(domain)
    check_mobile_friendliness(domain)
```

### 3.4 Competitor Agent
The most logic-heavy ingestion agent.

```python
def discover_competitors(startup_id):
    startup = get_startup(startup_id)

    # Step 1 — seed discovery from industry + description (SerpApi, free tier)
    serp_results = serpapi.search(
        f'best {startup.industry} tools site:g2.com OR site:capterra.com OR site:producthunt.com', num=20
    )

    # Step 2 — deterministic extraction, no LLM
    candidates = extract_product_names(serp_results)

    for candidate in candidates[:5]:
        comp_site = scrape_competitor_site(candidate.url)

        # Step 3 — local embedding similarity, no LLM, no API cost
        similarity = cosine_similarity(
            embed(startup.value_proposition), embed(comp_site.hero_copy)
        )

        if similarity >= COMPETITOR_SIMILARITY_THRESHOLD:
            write_fact("Competitor", {
                "name": candidate.name, "url": candidate.url, "hero_copy": comp_site.hero_copy,
                "pricing_model": extract_pricing(comp_site), "features": extract_features(comp_site),
                "positioning_angle": comp_site.h1, "detected_at": now(),
            })
    # Weekly re-scan: hash hero_copy + pricing text, diff against last scan, write ChangeEvent if hash differs.
```

**Threshold calibration — not a guess:**
```python
# Build once: 50 (startup, candidate) pairs, hand-labeled true/false competitor.
# Sweep threshold, pick the value that maximizes F1. Re-run whenever the embedding model changes.
def calibrate_similarity_threshold(labeled_pairs: list[tuple[float, bool]]) -> float:
    best_f1, best_t = 0, 0.72
    for t in [round(x * 0.01, 2) for x in range(50, 95)]:
        preds = [(score >= t) for score, _ in labeled_pairs]
        f1 = f1_score([label for _, label in labeled_pairs], preds)
        if f1 > best_f1:
            best_f1, best_t = f1, t
    return best_t
```

**Positioning-gap analysis is the one step in this agent that genuinely needs an LLM** — run through `run_agent()` with a `PositioningGap` output schema (fields: `gaps: list[str]`, `opportunities: list[str]`), never a bare prompt.

### 3.5 Integration Agents (GA4, Stripe, GSC)

```python
def pull_ga4(startup_id, property_id, credentials):
    client = BetaAnalyticsDataClient(credentials=credentials)
    response = client.run_report(RunReportRequest(
        property=f"properties/{property_id}",
        dimensions=[Dimension(name="date")],
        metrics=[Metric(name="sessions"), Metric(name="conversions"),
                 Metric(name="bounceRate"), Metric(name="averageSessionDuration")],
        date_ranges=[DateRange(start_date="30daysAgo", end_date="today")],
    ))
    for row in response.rows:
        write_fact("TrafficMetric", {
            "date": row.dimension_values[0].value, "sessions": row.metric_values[0].value,
            "conversions": row.metric_values[1].value,
        }, idempotency_key=build_idempotency_key("TrafficMetric", startup_id, "ga4", row.dimension_values[0].value))
    detect_traffic_anomalies(startup_id)

CRITICAL_STRIPE_EVENTS = [
    "customer.subscription.deleted", "invoice.payment_failed",
    "customer.subscription.created", "charge.refunded",
]

def handle_stripe_webhook(event):
    if event.type in CRITICAL_STRIPE_EVENTS:
        severity = "HIGH" if ("deleted" in event.type or "failed" in event.type) else "INFO"
        write_fact("RevenueEvent", {
            "type": event.type, "customer_id": event.data.object.customer,
            "amount": event.data.object.amount, "timestamp": event.created, "severity": severity,
        }, idempotency_key=f"stripe:{event.id}")   # Stripe event IDs are already unique — use them directly
        if severity == "HIGH":
            trigger_immediate_alert(startup_id)   # don't wait for the daily cycle
```

### 3.6 Analysis Agents

**SEO Analysis Agent — scoring is pure math, no LLM:**
```python
SEO_WEIGHTS = {
    "missing_meta_description": {"impact": 0.6, "effort": 0.1},
    "broken_h1": {"impact": 0.7, "effort": 0.1},
    "keyword_gap_high_volume": {"impact": 0.9, "effort": 0.7},
    "slow_lcp": {"impact": 0.8, "effort": 0.6},
    "missing_sitemap": {"impact": 0.5, "effort": 0.05},
    "no_schema_markup": {"impact": 0.4, "effort": 0.3},
}

def score_seo_issue(issue_type, volume=None):
    base = SEO_WEIGHTS[issue_type]
    impact = base["impact"]
    if volume:
        impact = min(impact * min(volume / 10000, 2.0), 1.0)
    return {"impact": impact, "effort": base["effort"], "priority_score": impact / (base["effort"] + 0.01)}
```
The recommendation write-up itself goes through `run_agent()` with an `SEORecommendation` schema:
```python
class SEORecommendation(BaseModel):
    title: str
    description: str
    evidence_fact_id: str          # must reference a real graph fact — checked in run_agent()
    effort_hours: float
    expected_impact: Literal["low", "medium", "high"]

SEO_RECOMMENDATION_AGENT = AgentContract(
    name="seo_recommendation_agent", model=MODEL_ROUTES["seo_recommendation"][0],
    fallback_model=MODEL_ROUTES["seo_recommendation"][1],
    system_prompt="You are an SEO expert. For each issue, write a specific, actionable "
                   "recommendation that cites the exact graph fact that triggered it.",
    output_schema=SEORecommendation,
)
```

**Content Analysis Agent — decomposed across three model calls, each right-sized for its job:**
```python
def generate_blog_recommendations(startup_id):
    gaps = get_keyword_gaps(startup_id, min_volume=500, max_difficulty=50)
    clusters = cluster_keywords(gaps, n_clusters=5)   # deterministic, no LLM

    for cluster in clusters[:3]:
        # Step 1 — cheap model drafts the brief skeleton (title, H2s, target keyword)
        brief_skeleton = await run_agent(BRIEF_SKELETON_AGENT, {"cluster": cluster})

        # Step 2 — mid-tier model checks differentiation vs the competitor's existing content
        differentiation = await run_agent(DIFFERENTIATION_CHECK_AGENT, {
            "brief": brief_skeleton, "competitor_content": cluster.top_competitor.content
        })

        write_recommendation("BlogPost", {
            "brief": brief_skeleton, "differentiation_notes": differentiation,
            "target_keyword": cluster.centroid_keyword,
            "evidence": f"Competitor {cluster.top_competitor} ranks for "
                        f"'{cluster.centroid_keyword.term}', we have zero visibility",
        })
        # Final prose generation happens only on approval — see 3.7 Execution Agents
```

**Health Score Agent — pure calculation, zero LLM calls, fully explainable:**
```python
def calculate_health_score(startup_id, stage):
    facts = get_all_facts(startup_id)

    technical = {
        "lcp": score_metric(facts.lcp_ms, good=2500, bad=4000, invert=True),
        "cls": score_metric(facts.cls, good=0.1, bad=0.25, invert=True),
        "has_sitemap": 1.0 if facts.has_sitemap else 0.0,
        "has_meta_desc": 1.0 if facts.meta_description else 0.2,
        "mobile_friendly": 1.0 if facts.mobile_score > 90 else facts.mobile_score / 100,
        "broken_links": 1.0 if not facts.broken_links else max(0, 1 - len(facts.broken_links) / 10),
    }
    technical_score = weighted_avg(technical, weights={
        "lcp": 0.30, "cls": 0.20, "has_sitemap": 0.10,
        "has_meta_desc": 0.15, "mobile_friendly": 0.15, "broken_links": 0.10,
    })

    # market_evidence and early_feedback degrade gracefully to neutral (0.5) when the
    # MarketSignal / Customer entities (Section 4) have no facts yet — deferred agents
    # never produce a zero score, only a neutral one.
    validation = {
        "market_evidence": score_market_evidence(facts.market_signals if facts.market_signals else None),
        "competitor_density": score_competitor_density(facts.competitors),
        "pricing_viability": score_pricing(facts.competitor_pricing, facts.own_pricing),
        "early_feedback": score_feedback(facts.customer_feedback) if facts.customer_feedback else 0.5,
    }

    growth = ({
        "traffic_trend": calculate_trend(facts.traffic_metrics, "sessions"),
        "conversion_trend": calculate_trend(facts.traffic_metrics, "conversions"),
        "revenue_trend": calculate_trend(facts.revenue_metrics) if facts.revenue_metrics else None,
    } if facts.traffic_metrics else {"traffic_trend": 0.0})

    weights = STAGE_WEIGHTS[stage]
    overall = (technical_score * weights["technical"] +
               weighted_avg(validation) * weights["validation"] +
               weighted_avg(growth) * weights["growth"]) * 100

    return {
        "overall": round(overall, 1), "technical": round(technical_score * 100, 1),
        "validation": round(weighted_avg(validation) * 100, 1), "growth": round(weighted_avg(growth) * 100, 1),
        "explainability": {"technical_breakdown": technical, "validation_breakdown": validation,
                            "growth_breakdown": growth},
    }

def score_metric(value, good, bad, invert=False):
    if invert:
        value, good, bad = -value, -good, -bad
    if value >= good: return 1.0
    if value <= bad: return 0.0
    return (value - bad) / (good - bad)

STAGE_WEIGHTS = {
    "idea":   {"technical": 0.15, "validation": 0.60, "growth": 0.25},
    "mvp":    {"technical": 0.20, "validation": 0.45, "growth": 0.35},
    "growth": {"technical": 0.25, "validation": 0.15, "growth": 0.60},
}
```

### 3.7 Execution Agents

**Blog post — contract-wrapped, brand-voice validated, never auto-published:**
```python
async def execute_blog_draft(recommendation_id, startup_id):
    rec = get_recommendation(recommendation_id)
    voice = get_fact("BrandVoice", startup_id)

    post = await run_agent(BLOG_WRITER_AGENT, {
        "brief": rec.brief, "voice_samples": voice,
        "target_keyword": rec.target_keyword, "startup": get_startup(startup_id),
    })

    write_fact("ContentDraft", {
        "recommendation_id": recommendation_id, "type": "blog", "content": post.content,
        "status": "pending_approval", "created_at": now(),
    })
    notify_founder(startup_id, "Your blog post draft is ready for review")
```

**Social draft — LinkedIn + Facebook text, same pipeline pattern as blog, still draft-only:**
```python
class SocialDraftSchema(BaseModel):
    platform: Literal["linkedin", "facebook"]
    text: str
    char_count: int

SOCIAL_DRAFT_AGENT = AgentContract(
    name="social_draft_agent", model=MODEL_ROUTES["social_draft"][0],
    fallback_model=MODEL_ROUTES["social_draft"][1],
    system_prompt="Write short-form LinkedIn/Facebook posts derived from an approved blog "
                  "brief or detected growth-plan opportunity. Match the founder's brand voice "
                  "exactly. Never fabricate statistics not present in the source brief.",
    output_schema=SocialDraftSchema,
)

async def execute_social_draft(recommendation_id, startup_id, platform: Literal["linkedin", "facebook"]):
    rec = get_recommendation(recommendation_id)
    voice = get_fact("BrandVoice", startup_id)
    draft = await run_agent(SOCIAL_DRAFT_AGENT, {
        "source_brief": rec.brief, "platform": platform, "voice_samples": voice,
    })
    write_fact("ContentDraft", {
        "recommendation_id": recommendation_id, "type": platform, "content": draft.text,
        "status": "pending_approval", "created_at": now(),
    })
    notify_founder(startup_id, f"Your {platform} post draft is ready for review")
```
Blog and social both write `ContentDraft` with `status: "pending_approval"` — actual publishing, if and when it happens, is a separate call that must go through `ExecutionGate` (Section 7), which treats `publish_content` as irreversible regardless of channel.

**SEO metadata fix — auto-safe category, still respects the trust gate:**
```python
async def execute_seo_metadata_fix(recommendation_id, startup_id):
    rec = get_recommendation(recommendation_id)
    ExecutionGate().execute_action(
        startup_id, category="seo_metadata", action_risk="reversible_metadata_change",
        action_fn=write_corrected_meta_tags, rec=rec,
    )
```

**Account-provisioning agent — interface defined, not called in the active orchestrator:**
```python
class AccountProvisioningAgent(Protocol):
    """
    Not wired into any active pipeline. When implemented: takes an OAuth grant with
    account-creation scope, creates the target resource (e.g. a GA4 property, a
    PostHog project), and writes the result into the existing `Integration` entity
    (Section 4) — no new entity type needed.
    """
    async def provision(self, startup_id: str, tool: Literal["ga4", "posthog"]) -> "Integration": ...
```

### 3.8 Deferred Ingestion Agents (schema-ready, not yet run)
```python
MARKET_SIGNAL_AGENT = AgentContract(
    name="market_signal_agent", status="deferred",
    model=MODEL_ROUTES["market_signal"][0],
    system_prompt="Assess TAM signal and category trend direction from web search + trend data.",
    output_schema=MarketSignalSchema,
)

CUSTOMER_FEEDBACK_AGENT = AgentContract(
    name="customer_feedback_agent", status="deferred",
    model=MODEL_ROUTES["customer_feedback"][0],
    system_prompt="Summarize sentiment and churn-risk signals from connected review/support data.",
    output_schema=CustomerFeedbackSchema,
)
```
Both write to entities already defined in Section 4. The orchestrator's status filter (Section 3.1) keeps these from running until someone flips `status="active"` — at which point no schema work is needed, only the data-source integration.

---

## 4. Knowledge Graph — Schema & Write Rules

```
Startup
  ├── id, name, url, industry, stage, country, primary_goal
  ├── created_at, updated_at
  └── → has_many: WebsiteScans, Competitors, Recommendations, Integrations

WebsiteScan (append-only)
  ├── id, startup_id, timestamp
  ├── title, meta_description, h1, hero_copy, cta_texts[]
  ├── tech_stack[], word_count, page_count
  ├── lcp_ms, cls_score, fid_ms, mobile_score
  ├── broken_links[], has_sitemap, robots_policy
  └── screenshot_path

Competitor
  ├── id, startup_id, name, url, hero_copy, positioning_angle
  ├── pricing_model, pricing_tiers[], features[], detected_at
  └── → has_many: CompetitorScans (weekly snapshots)

Keyword
  ├── id, term, search_volume, keyword_difficulty
  ├── startup_ranking, competitor_rankings{}
  └── type: "owned" | "gap" | "opportunity"

Metric (never mutated — always a new row)
  ├── id, startup_id, type, value, date
  ├── type: "sessions" | "conversions" | "mrr" | "churn_rate" | "ltv"
  └── source: "ga4" | "stripe" | "posthog" | "manual"

Recommendation
  ├── id, startup_id, category, title, description
  ├── evidence_fact_ids[]   ← every rec must cite at least one real fact
  ├── impact_score, confidence_score, effort_score, priority_score
  ├── status: "pending" | "approved" | "edited" | "ignored" | "executed"
  ├── trust_level_required: 1|2|3|4
  └── → has_one: ExecutionResult

ContentDraft
  ├── id, startup_id, recommendation_id
  ├── type: "blog" | "linkedin" | "facebook" | "meta_tag" | "landing_page_copy"
  ├── content, status: "pending_approval" | "approved" | "published" | "rejected"
  └── published_url (if executed)

Integration
  ├── id, startup_id, type: "ga4"|"gsc"|"stripe"|"posthog"|...
  ├── connected: bool, access_token (encrypted), refresh_token
  ├── scopes[], connected_at, last_synced_at
  └── connection_health: "ok" | "expired" | "error"

FeedbackSignal
  ├── id, startup_id, recommendation_id
  ├── action: "approved" | "edited" | "ignored"
  ├── edit_delta_chars (larger = agent output was further off)
  ├── outcome_metric_id (linked after 30 days)
  └── timestamp

BrandVoice
  ├── id, startup_id, examples[], tone, avoid[]
  └── source: "onboarding_questionnaire" | "existing_content_sample"

TelemetryEvent (append-only, powers Section 10)
  ├── id, startup_id, event, timestamp, metadata

Customer / Segment   [schema-ready; only CUSTOMER_FEEDBACK_AGENT (status: deferred) writes here]
  ├── id, startup_id, segment_name, source ("hubspot" | "support_tool" | "manual")
  └── sentiment_score, churn_risk_score

MarketSignal   [schema-ready; only MARKET_SIGNAL_AGENT (status: deferred) writes here]
  ├── id, startup_id, tam_estimate, category_trend_direction, source
```

**Write rules, enforced at the repository layer:**
```python
class GraphRepository:
    def write_fact(self, entity_type, data, idempotency_key: str | None = None):
        assert "id" not in data or data["id"] is None                # never mutate, always insert
        assert "startup_id" in data                                   # always scoped to a startup
        if entity_type == "Recommendation":
            assert data.get("evidence_fact_ids"), \
                "Cannot create recommendation without citing graph facts"

        if idempotency_key and self.db.exists_by_key(entity_type, idempotency_key):
            return self.db.get_by_key(entity_type, idempotency_key)   # duplicate write is a no-op

        data["timestamp"] = utcnow()
        data["id"] = generate_ulid()
        data["idempotency_key"] = idempotency_key
        return self.db.insert(entity_type, data)
```

---

## 5. Idempotency — Concrete Mechanism

```python
def build_idempotency_key(entity_type: str, startup_id: str, source: str, window: str) -> str:
    """
    window = the natural dedup boundary for that fact type:
      - WebsiteScan: date (YYYY-MM-DD)
      - TrafficMetric: date + metric_type
      - CompetitorScan: iso_week
    """
    return f"{entity_type}:{startup_id}:{source}:{window}"

write_fact("WebsiteScan", scan_data,
           idempotency_key=build_idempotency_key("WebsiteScan", startup_id, "playwright", today()))
```
Running the daily cycle twice, or a Celery task being retried after a transient failure, produces identical graph state — the `exists_by_key` check makes the second write a no-op read, not a duplicate insert.

---

## 6. Recommendation Engine — Scoring Logic

```
priority_score = (impact × 0.6) × (confidence × 0.4) / (effort + 0.1)
```

**Impact estimation per category:**

| Category | Impact Formula |
|---|---|
| SEO fix (meta desc) | `0.3 + (keyword_volume / 50000)`, capped at 0.8 |
| SEO blog post | `estimated_monthly_sessions / baseline_sessions × 0.5` |
| Landing page copy | `current_conversion_rate × 0.2` |
| Competitor positioning gap | `gap.competitor_traffic_share × 0.4` |
| Revenue: fix churn | `(churned_mrr / total_mrr) × 0.8` |
| Revenue: failed payment recovery | `(failed_amount / total_mrr) × 0.9` |

**Confidence scoring — includes model tier, so a fallback-model output is automatically flagged lower confidence than a primary-model one:**
```python
MODEL_TIER_CONFIDENCE = {"frontier": 0.05, "mid": 0.0, "fallback": -0.1}
DATA_QUALITY = {"ga4_verified": 0.2, "stripe_verified": 0.25, "scraped": 0.05, "estimated": -0.1}

def calculate_confidence(recommendation, facts, model_tier: str):
    base = 0.5
    source_bonus = min(count_supporting_facts(recommendation.evidence_fact_ids) * 0.1, 0.3)
    quality_bonus = sum(DATA_QUALITY.get(f.source, 0) for f in facts)
    recency_penalty = -0.05 * count_stale_facts(facts, days=14)
    return min(max(base + source_bonus + quality_bonus + recency_penalty
                   + MODEL_TIER_CONFIDENCE[model_tier], 0), 1)
```

**Primary-goal weighting (from onboarding):**
```python
GOAL_MULTIPLIERS = {
    "get_more_customers": {"seo": 1.4, "content": 1.3, "landing_page": 1.5,
                            "competitor_gap": 1.2, "retention": 0.7, "churn": 0.8},
    "retain_existing_customers": {"seo": 0.8, "content": 0.9, "churn": 1.6,
                                   "retention": 1.5, "onboarding": 1.4, "landing_page": 0.9},
}

def apply_goal_weighting(recommendations, primary_goal):
    multipliers = GOAL_MULTIPLIERS[primary_goal]
    for rec in recommendations:
        rec.priority_score *= multipliers.get(rec.category, 1.0)
    return sorted(recommendations, key=lambda r: r.priority_score, reverse=True)
```

**30-day plan — dependency-ordered, never recommends step N before step N-1:**
```python
DEPENDENCIES = {
    "product_hunt_launch": ["landing_page_copy", "meta_description"],
    "seo_blog_posts": ["tech_seo_fixes"],
    "ab_test_onboarding": ["has_analytics_goal_configured"],
    "paid_ads": ["landing_page_copy", "conversion_tracking"],
    "linkedin_content": ["brand_voice_defined"],
}

def build_30_day_plan(ranked_recommendations, startup_id):
    plan_weeks = {1: [], 2: [], 3: [], 4: []}
    completed = set(get_completed_actions(startup_id))
    for week in [1, 2, 3, 4]:
        for rec in ranked_recommendations:
            deps = DEPENDENCIES.get(rec.category, [])
            if all(dep in completed or dep in get_week_items(plan_weeks, week - 1) for dep in deps):
                plan_weeks[week].append(rec)
                if len(plan_weeks[week]) >= 3:
                    break
    return plan_weeks
```

---

## 7. Trust Ladder & Execution Gate

```python
class TrustLadder:
    LEVELS = {
        1: "suggest_only",       # weeks 1-2: propose, founder does it manually
        2: "draft_dont_send",    # weeks 3-4: agent prepares, founder approves
        3: "execute_confirm",    # after 5+ accepted recs in category
        4: "autonomous",         # after 15+ accepted recs, no reversible risk
    }
    CATEGORIES = ["seo_metadata", "content_blog", "content_social",
                  "landing_page", "email_outreach", "pricing"]

    def get_trust_level(self, startup_id, category):
        signals = get_feedback_signals(startup_id, category)
        approved = [s for s in signals if s.action == "approved"]
        acceptance_rate = len(approved) / max(len(signals), 1)
        if len(approved) >= 15 and acceptance_rate > 0.8: return 4
        if len(approved) >= 5 and acceptance_rate > 0.7: return 3
        if len(approved) >= 2: return 2
        return 1

class ExecutionGate:
    """
    The ONLY function with write access to any side-effecting action. No execution agent
    calls a publish/send/change function directly — every one of them calls
    ExecutionGate.execute_action() instead. This is what makes the trust ladder
    structurally unbypassable rather than an if-check any future code path could skip.
    """
    IRREVERSIBLE = {"email_customers", "change_pricing", "publish_content", "delete_data"}
    AUTO_SAFE = {"seo_metadata", "monitoring_report"}   # content_social is NEVER auto-safe —
                                                          # publishing is irreversible by definition

    def execute_action(self, startup_id, category, action_risk, action_fn, *args):
        trust = trust_ladder.get_trust_level(startup_id, category)
        if action_risk in self.IRREVERSIBLE and trust < 3:
            raise ExecutionBlocked("Irreversible action requires trust level 3+")
        if trust == 4 and category in self.AUTO_SAFE:
            return action_fn(*args)
        return queue_for_confirmation(action_fn, args)
```
`content_social` and `content_blog` drafts are always `action_risk="publish_content"` — always in `IRREVERSIBLE` — so a founder never gets auto-published content, even at trust level 4, until that's a deliberate future decision (a change to `AUTO_SAFE`, reviewed on its own).

---

## 8. Evaluation Harness

```python
async def run_eval_suite(contract: AgentContract, golden_set: list[dict]) -> EvalReport:
    """
    golden_sets/<agent_name>.jsonl — 15-30 hand-reviewed (input, rubric) pairs per active agent.
    Run in CI on every prompt or model change, before deploy.
    """
    results = []
    for example in golden_set:
        output = await run_agent(contract, example["context"])
        score = await llm_judge(model=JUDGE_MODEL, criteria=example["rubric"], output=output)
        results.append({"id": example["id"], "score": score, "output": output})

    pass_rate = sum(r["score"] >= 0.7 for r in results) / len(results)
    return EvalReport(contract.name, pass_rate, results)

# Deploy gate: block if pass_rate < 0.85 on any active agent's golden set.
```
Pair with a 5%-of-production human spot-check queue, independent of the 30-day outcome loop (Section 14), so quality drift surfaces in days, not a month.

---

## 9. Model Routing & Cost Control

Route by task difficulty, reversibility, and call frequency. The cheapest model that clears the eval bar (Section 8) wins that step; escalate to a stronger model only on eval or runtime failure — never default to the most expensive model everywhere.

```python
MODEL_ROUTES = {
    # step name → (primary model, fallback model)
    "brief_skeleton":           ("qwen/qwen3-coder:free",     "google/gemini-3.5-flash"),
    "differentiation_check":    ("anthropic/claude-sonnet-5", "google/gemini-3.5-flash"),
    "seo_recommendation":       ("anthropic/claude-sonnet-5", "openai/gpt-5.6"),
    "competitor_gap_analysis":  ("anthropic/claude-sonnet-5", "z-ai/glm-5.2"),
    "blog_final_draft":         ("anthropic/claude-opus-4.8", "anthropic/claude-sonnet-5"),
    "social_draft":             ("anthropic/claude-sonnet-5", "google/gemini-3.5-flash"),
    "daily_anomaly_summary":    ("google/gemini-3.5-flash",   "qwen/qwen3-coder:free"),
    "long_horizon_seo_audit":   ("z-ai/glm-5.2",               "anthropic/claude-opus-4.8"),
    "classification/routing":   ("qwen/qwen3-coder:free",      "openai/gpt-oss-120b:free"),
    "market_signal":            ("google/gemini-3.5-flash",   "qwen/qwen3-coder:free"),    # deferred agent
    "customer_feedback":        ("anthropic/claude-sonnet-5", "google/gemini-3.5-flash"),  # deferred agent
}
```

| Task type | Model (OpenRouter id) | Why |
|---|---|---|
| Final brand-voice blog copy — highest stakes, ships externally | `anthropic/claude-opus-4.8` | Best writing/instruction-following available; worth frontier price for the one step that's fully public-facing |
| SEO reasoning, competitor positioning-gap analysis, social drafts | `anthropic/claude-sonnet-5` (fallback `openai/gpt-5.6`) | Near-Opus reasoning at a fraction of the cost — the right fit for structured analytical output and short-form brand-voice text |
| Long-horizon, multi-step audits | `z-ai/glm-5.2` | 1M context, purpose-built for long-horizon agent workflows |
| Deterministic extraction / classification / routing | `qwen/qwen3-coder:free` or `openai/gpt-oss-120b:free` | Free tier is enough for binary/simple decisions — don't pay frontier prices for "is this a real competitor candidate?" |
| High-frequency, low-stakes daily summaries | `google/gemini-3.5-flash` | Best price-performance for high-volume, low-latency tasks |
| Embeddings for similarity matching | local `sentence-transformers` | No API cost — never make this an LLM call |

**Cost discipline — recompute whenever a route changes, keep it in config, not a spreadsheet:**
```python
def estimate_monthly_cost(active_startups: int) -> dict:
    daily_calls = {
        "seo_recommendation": 3, "competitor_gap_analysis": 1,
        "daily_anomaly_summary": 1, "brief_skeleton": 0.3, "blog_final_draft": 0.1,
        "social_draft": 0.3,
    }
    ...  # multiply by per-model $/1M-token rates from MODEL_ROUTES, sum, report before every pricing decision
```

---

## 10. Telemetry — Product Success Metrics

```python
class TelemetryEvent(BaseModel):
    startup_id: str
    event: Literal[
        "signup_started", "report_delivered",       # → time-to-report
        "integration_connected",                      # → % connecting ≥1 tool
        "plan_item_approved", "plan_item_ignored",     # → approval rate
        "briefing_viewed",                             # → week-1+ retention
        "outcome_recorded",                            # → 30-day metric-moved rate
    ]
    timestamp: datetime
    metadata: dict = {}

def log_event(startup_id: str, event: str, **metadata):
    write_fact("TelemetryEvent", {"startup_id": startup_id, "event": event,
                                   "timestamp": utcnow(), "metadata": metadata})

def time_to_first_report(startup_id) -> timedelta:
    return get_event(startup_id, "report_delivered").timestamp - get_event(startup_id, "signup_started").timestamp

def week1_retention_rate(cohort_start: date, cohort_end: date) -> float:
    cohort = get_startups_signed_up(cohort_start, cohort_end)
    returned = [s for s in cohort if has_event_after(s.id, "briefing_viewed", days_after=7)]
    return len(returned) / max(len(cohort), 1)
```
`log_event()` calls sit at the same call sites where onboarding already emits WebSocket progress (Section 12) — one extra line, no separate analytics system needed for the first release.

---

## 11. Free APIs vs Build-From-Scratch

### Free / Freemium APIs

| Service | What it gives you | Free tier | Complexity |
|---|---|---|---|
| Google Search Console API | Real keyword impressions, clicks, CTR, positions | Free, unlimited (OAuth) | Medium |
| Google Analytics Data API (GA4) | Sessions, conversions, behavior | Free, unlimited (OAuth) | Medium |
| Stripe Webhooks | Real-time payment events, churn, MRR | Free, no quota | Low |
| SerpApi | Google/Bing SERP results | 100 searches/month free | Low |
| Google PageSpeed Insights API | Core Web Vitals | Free, 25,000 req/day | Very low |
| Open Graph / meta scraping | Competitor meta data without JS | Free, self-built | Low |
| Google Trends (`pytrends`) | Market trend signals | Free | Low |
| Hacker News API | Market validation signals | Free, no auth | Very low |
| Product Hunt API | Competitor launch tracking | Free GraphQL | Low |
| Lighthouse (headless) | Technical audit scores | Free, bundled with Chrome | Medium |
| Playwright | Dynamic site scraping | Free, open source | Medium |
| `sentence-transformers` (local) | Embeddings for similarity | Free, local model | Medium |

> [!NOTE]
> Re-verify free-tier limits quarterly — API pricing and terms change faster than this document does.

**DataForSEO has no meaningful free tier for production.** MVP alternative that covers ~80% of its use cases at $0: Search Console API for keywords you already rank for, SerpApi's free tier for competitor discovery, `pytrends` for trend direction.

### Build From Scratch

| Component | Why | Complexity |
|---|---|---|
| Agent Contract Runner | Central schema-validated, retry/fallback-aware LLM wrapper — Section 2 | Medium |
| Idempotency helper | Concrete dedup mechanism — Section 5 | Low |
| Eval Harness | Golden-set regression testing, gates deploys — Section 8 | Medium |
| Knowledge Graph Engine | Append-only, timestamped, event-sourced | High |
| Orchestrator/Scheduler | Per-source, per-startup, status-filtered scheduling | Medium |
| Health Score Calculator | 100% custom domain logic, no LLM | Low |
| Recommendation Ranking Engine | Custom impact×confidence/effort formula, goal-weighted | Medium |
| 30-Day Plan Sequencer | Dependency-aware DAG traversal (`networkx`) | Medium |
| Trust Ladder + ExecutionGate | Per-startup, per-category state machine, single choke point | Medium |
| Tech Stack Fingerprinter | Pattern matching on HTML/headers | Low |
| Competitor Discovery Pipeline | SERP → parse → embedding-similarity filter | High |
| Trend Anomaly Detector | Z-score on rolling window, no ML needed | Medium |
| Brand Voice Extractor | Few-shot LLM call, stored as structured JSON | Medium |
| Website Diff Engine | Hash key elements, write ChangeEvent on hash diff | Medium |
| Telemetry aggregator | Plain SQL over `TelemetryEvent` | Low |

### Build Order
```
Phase 0 — Foundations (~4-5 days)
  0a. Agent contract runner + status filter (Section 2, 3.1)
  0b. Idempotency key helper (Section 5)
  0c. Minimal eval harness skeleton (Section 8) — even 5 golden examples per agent beats zero
  0d. TelemetryEvent table + log_event() stubbed at onboarding call sites (Section 10)

Phase 1 — Data Foundation (Week 1-2)
  1. Knowledge graph schema — including Customer/MarketSignal/BrandVoice tables even
     though the first two stay empty until their agents are activated
  2. Website scraper (Playwright + fingerprinter + bot-block fallback)
  3. Competitor discovery (SerpApi + parser + calibrated similarity threshold)
  4. GA4 + Search Console integration
  5. Stripe webhook handler

Phase 2 — Intelligence Layer (Week 3-4)
  6. Health score calculator (confirm graceful degradation on missing data)
  7. SEO analysis agent (contract-wrapped, model-routed)
  8. Recommendation ranking engine
  9. 30-day plan sequencer

Phase 3 — Execution Layer (Week 5-6)
  10. Blog post draft agent (skeleton → differentiation → final draft, three models)
  11. Social draft agent — LinkedIn + Facebook, reuses the blog pipeline's brand-voice
      and trust-gate plumbing
  12. SEO metadata fix agent
  13. Trust ladder + ExecutionGate (single choke point)
  14. Approve/Edit/Ignore UI + feedback writer

Phase 4 — Monitoring & Polish (Week 7-8)
  15. Orchestrator scheduler (Celery, status-filtered, idempotency-keyed)
  16. Trend anomaly detector
  17. Daily briefing generator
  18. Cost dashboard + telemetry rollup queries
```

---

## 12. Onboarding Pipeline — Step-by-Step Logic

MVP discovery scan runs three parallel agents — website, competitor, SEO. Market and customer-feedback agents are schema-ready (Section 3.8) but `status: deferred`, and are skipped here by design.

```python
async def run_onboarding(startup_id):
    log_event(startup_id, "signup_started")
    startup = get_startup(startup_id)

    if startup.url:
        emit_progress("Scanning your website...", 10)
        scan = await scrape_website(startup.url)
        if scan:
            write_fact("WebsiteScan", scan,
                       idempotency_key=build_idempotency_key("WebsiteScan", startup_id, "playwright", today()))
        emit_progress("Website scan complete ✓" if scan else "Website scan skipped (site unreachable)", 25)

    emit_progress("Identifying your competitors...", 30)
    competitors = await run_ingestion_stage(startup_id, [COMPETITOR_AGENT])
    emit_progress(f"Found {len(competitors.get('competitor_agent') or [])} competitors ✓", 45)

    emit_progress("Analyzing SEO opportunities...", 55)
    await run_ingestion_stage(startup_id, [SEO_AGENT])
    emit_progress("SEO analysis complete ✓", 65)

    if startup.integrations:
        emit_progress("Pulling your analytics data...", 75)
        await integration_agents.run_all(startup_id)
        emit_progress("Analytics synced ✓", 82)

    emit_progress("Calculating your startup health score...", 88)
    scores = health_score_agent.calculate(startup_id, startup.stage)

    emit_progress("Building your growth plan...", 95)
    plan = plan_sequencer.build_30_day(recommendation_engine.generate(startup_id), startup_id)

    emit_progress("Your LaunchPilot report is ready! 🚀", 100)
    log_event(startup_id, "report_delivered")
    return {"scores": scores, "plan": plan}
```

**Progress emission (WebSocket, not a blank spinner):**
```json
{ "step": "Analyzing SEO opportunities...", "percent": 55,
  "detail": "Comparing your keyword rankings against 4 competitors", "timestamp": "..." }
```

---

## 13. Continuous Monitoring Scheduler

```python
CELERY_BEAT_SCHEDULE = {
    "daily-website-scan":       {"task": "agents.website_scraper.run_for_all", "schedule": crontab(hour=6, minute=0)},
    "daily-ga4-pull":           {"task": "agents.ga4.pull_for_all", "schedule": crontab(hour=6, minute=15)},
    "daily-briefing-generate":  {"task": "agents.briefing.generate_for_all", "schedule": crontab(hour=7, minute=0)},
    "weekly-competitor-scan":   {"task": "agents.competitor.scan_all", "schedule": crontab(day_of_week=1, hour=5, minute=0)},
    "weekly-seo-scan":          {"task": "agents.seo.full_scan_all", "schedule": crontab(day_of_week=1, hour=5, minute=30)},
    # Stripe is real-time via webhook — no polling.
}

def check_alerts(startup_id):
    recent_metrics = get_metrics_last_7_days(startup_id)
    for metric_type in ["sessions", "conversions", "mrr"]:
        values = [m.value for m in recent_metrics if m.type == metric_type]
        if len(values) < 7:
            continue
        rolling_avg = mean(values[:-1])
        z_score = (values[-1] - rolling_avg) / (stdev(values[:-1]) + 0.001)
        if z_score < -2.0:
            write_fact("Alert", {"type": f"{metric_type}_drop", "severity": "HIGH",
                                  "value": values[-1], "expected": rolling_avg, "z_score": z_score})
            send_notification(startup_id,
                f"⚠️ {metric_type} dropped {abs((values[-1]/rolling_avg - 1) * 100):.0f}% below your 7-day average")
```
Every scheduled write uses an idempotency key — a Celery retry after a transient failure can't double-write a day's data.

---

## 14. Feedback Loop Architecture

```python
class FeedbackProcessor:
    def process_signal(self, startup_id, recommendation_id, action, edit_content=None):
        rec = get_recommendation(recommendation_id)
        write_fact("FeedbackSignal", {
            "startup_id": startup_id, "recommendation_id": recommendation_id, "action": action,
            "edit_delta_chars": len(edit_content) - len(rec.content) if edit_content else 0,
            "category": rec.category,
        })
        log_event(startup_id, f"plan_item_{action}", recommendation_id=recommendation_id)
        self.adjust_weights(startup_id, rec.category, action)
        trust_ladder.update(startup_id, rec.category, action)

    def adjust_weights(self, startup_id, category, action):
        ADJUSTMENTS = {"approved": +0.05, "edited": -0.02, "ignored": -0.10}
        prefs = get_startup_prefs(startup_id)
        current = prefs.category_weights.get(category, 1.0)
        update_pref(startup_id, f"category_weights.{category}", max(0.3, min(2.0, current + ADJUSTMENTS[action])))

    def track_outcome(self, recommendation_id, days_after=30):
        rec = get_recommendation(recommendation_id)
        before = get_metric_at_time(rec.startup_id, rec.target_metric, rec.executed_at)
        after = get_metric_at_time(rec.startup_id, rec.target_metric, rec.executed_at + timedelta(days=days_after))
        if after and before:
            change_pct = (after.value - before.value) / before.value
            write_fact("OutcomeRecord", {
                "recommendation_id": recommendation_id, "metric_type": rec.target_metric,
                "before": before.value, "after": after.value, "change_pct": change_pct,
                "recommendation_worked": change_pct > 0.05,
            })
            log_event(rec.startup_id, "outcome_recorded", recommendation_id=recommendation_id, change_pct=change_pct)
            (boost_impact_estimate if change_pct > 0.05 else reduce_impact_estimate)(rec.category, rec.startup_id)
```

---

## 15. Build Order & MVP Checklist

### Must Have Before Beta
- [ ] Agent contract runner + status filter + idempotency helper (Sections 2, 3.1, 5)
- [ ] Minimal eval harness — golden sets for every active agent
- [ ] Telemetry event log + rollup queries (time-to-report, tool-connect rate, approval rate, week-1 retention, 30-day outcome rate)
- [ ] Onboarding flow — website scrape → competitor → SEO, live WebSocket progress
- [ ] Website scraper — Playwright + fingerprint + Core Web Vitals + broken links + bot-block fallback
- [ ] Competitor discovery — SerpApi seeded, calibrated similarity threshold
- [ ] Knowledge graph schema — including `Customer`, `MarketSignal`, `BrandVoice` tables now, even though two stay empty until their agents activate
- [ ] Health score — three sub-scores, explainability JSON, confirmed graceful degradation
- [ ] SEO analysis — cited, schema-validated recommendations
- [ ] AI Startup Report — 3-5 problems, 3-5 opportunities, competitor summary
- [ ] 30-Day Plan — dependency-ordered, goal-weighted
- [ ] Blog post draft agent — decomposed pipeline, brand voice, model-routed per step
- [ ] Social draft agent — LinkedIn + Facebook text, draft-only, same trust gate as blog
- [ ] SEO metadata fix executor
- [ ] GA4 + Stripe integrations — OAuth, idempotent writes
- [ ] Approve / Edit / Ignore UI + feedback writer + telemetry events
- [ ] Trust ladder + ExecutionGate — `content_social`/`content_blog` always confirm-gated, never auto-safe
- [ ] Daily website + GA monitoring — idempotency-keyed, anomaly detection, alerts
- [ ] Cost dashboard — per-model, per-startup spend visible before pricing is finalized

### Deferred (schema-ready or interface-stubbed, not built)
| Item | State right now | What activates it |
|---|---|---|
| Market/TAM analysis | Schema + agent contract exist, `status: deferred` | Flip status, wire a data source |
| Customer feedback analysis | Schema + agent contract exist, `status: deferred` | Flip status, wire HubSpot/support-tool integration |
| Auto account provisioning | Interface stubbed | Implement `AccountProvisioningAgent.provision()` |
| Autonomous publishing (any channel) | Structurally blocked by `ExecutionGate` | Deliberate `AUTO_SAFE` change, reviewed on its own |
| YouTube/Instagram, video content | Not designed — different pipeline entirely (script → render) | New workstream |
| PostHog / Clarity / HubSpot / GitHub integrations | Not designed | New integration agents |
| Full 30-day outcome automation | `track_outcome()` exists, not scheduled | Add to Celery beat |

---

## 16. Key Engineering Principles

1. Every recommendation must cite graph facts — enforced at parse time in `run_agent()`, not just at the database layer.
2. Knowledge graph is append-only and every write is idempotency-keyed — no UPDATE, no accidental duplicates on retry.
3. Trust ladder blocks irreversible actions through a single choke point (`ExecutionGate`) — publishing to any channel is always irreversible until a deliberate, reviewed change says otherwise.
4. Cold start must produce real value from website + competitor + SEO alone — integrations only sharpen the report, they never gate it.
5. Progress must be visible — granular WebSocket events during onboarding, never a blank spinner.
6. Health scores must be explainable and must degrade gracefully — never silently — when a deferred data source is absent.
7. Stage weights are hardcoded rules, not LLM guesses — the scoring formula never changes based on what a model thinks; only the weighting table changes by stage.
8. Failure isolation is a runner-level guarantee, not a per-agent convention — one failed agent must never take down a report.
9. No agent ships a prompt change without clearing its eval harness pass-rate bar.
10. No model is used where a deterministic function would be more reliable and cheaper — reserve LLM calls for genuine reasoning and generation.
11. A component named anywhere in product planning is either built, actively deferred with a `status` flag and a schema slot, or explicitly out of scope — never silently absent.

---

*This is the build spec. Update it in the same PR as any change to scope, entities, or agents — it should never fall out of sync with what's actually running.*