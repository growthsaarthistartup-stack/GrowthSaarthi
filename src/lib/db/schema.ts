/**
 * Knowledge Graph — Drizzle ORM schema (Postgres via Neon).
 *
 * Design rules (from spec §4):
 *   • NEVER mutate a fact. Every table is append-only (no updatedAt on fact tables).
 *   • Startup is the only mutable root entity (it stores config, not facts).
 *   • Every fact table has: id (ULID text PK), startup_id FK, created_at (auto), idempotency_key.
 *   • Customer / MarketSignal tables exist now even though their agents are deferred — schema-first.
 */

import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

// crypto.subtle.digest is available in Node 18+ / Edge runtime
// We use it for content-hash computation in the SEO audit cache.
import { createHash } from "crypto";
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const startupStageEnum = pgEnum("startup_stage", ["idea", "mvp", "growth"]);
export const primaryGoalEnum  = pgEnum("primary_goal",  ["get_more_customers", "retain_existing_customers"]);
export const metricTypeEnum   = pgEnum("metric_type",   ["sessions", "conversions", "mrr", "churn_rate", "ltv"]);
export const metricSourceEnum = pgEnum("metric_source", ["ga4", "stripe", "posthog", "manual"]);
export const recStatusEnum    = pgEnum("rec_status",    ["pending", "approved", "edited", "ignored", "executed"]);
export const contentTypeEnum  = pgEnum("content_type",  ["blog", "linkedin", "facebook", "youtube", "instagram", "twitter", "meta_tag", "landing_page_copy"]);
export const contentStatusEnum = pgEnum("content_status", ["pending_approval", "approved", "published", "rejected"]);
export const integrationTypeEnum = pgEnum("integration_type", ["ga4", "gsc", "stripe", "posthog", "hubspot", "github", "clarity", "linkedin", "youtube", "facebook", "instagram", "twitter"]);
export const connectionHealthEnum = pgEnum("connection_health", ["ok", "expired", "error"]);
export const feedbackActionEnum = pgEnum("feedback_action", ["approved", "edited", "ignored"]);
export const brandVoiceSourceEnum = pgEnum("brand_voice_source", ["onboarding_questionnaire", "existing_content_sample"]);
// competitive_gap: term found in 2+ competitors but absent from startup's keywords
export const keywordTypeEnum = pgEnum("keyword_type", ["owned", "gap", "opportunity", "competitive_gap"]);
export const keywordConfidenceEnum = pgEnum("keyword_confidence", ["gsc", "serpapi_rank", "competitor_inferred"]);
export const seoMaturityEnum = pgEnum("seo_maturity", ["unknown", "cold_start", "emerging", "established"]);
export const telemetryEventEnum = pgEnum("telemetry_event", [
  "signup_started",
  "report_delivered",
  "integration_connected",
  "plan_item_approved",
  "plan_item_ignored",
  "briefing_viewed",
  "outcome_recorded",
  "content_decay_skipped_no_baseline",
]);

// ---------------------------------------------------------------------------
// 0. Auth tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id:           text("id").primaryKey(), // ULID
  email:        text("email").notNull().unique(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otps = pgTable("otps", {
  id:           text("id").primaryKey(),
  email:        text("email").notNull(),
  code:         text("code").notNull(),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id:           text("id").primaryKey(), // ULID (this serves as the session token in the cookie)
  userId:       text("user_id").notNull().references(() => users.id),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 1. Startup — mutable root entity (config, not a fact)
// ---------------------------------------------------------------------------

export const startups = pgTable("startups", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").references(() => users.id),
  name:         text("name").notNull(),
  url:          text("url"),
  logoUrl:      text("logo_url"),
  industry:     text("industry"),
  stage:        startupStageEnum("stage").notNull().default("mvp"),
  country:      text("country"),
  primaryGoal:  primaryGoalEnum("primary_goal").notNull().default("get_more_customers"),
  /** Derived from keyword ingestion: cold_start = no real ranking footprint */
  seoMaturity:  seoMaturityEnum("seo_maturity").notNull().default("unknown"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// 2. WebsiteScan — append-only, never mutated
// ---------------------------------------------------------------------------

export const websiteScans = pgTable("website_scans", {
  id:                text("id").primaryKey(),
  startupId:         text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:    text("idempotency_key").unique(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  url:               text("url").notNull(),
  logoUrl:           text("logo_url"),
  title:             text("title"),
  metaDescription:   text("meta_description"),
  h1:                text("h1"),
  heroCopy:          text("hero_copy"),
  ctaTexts:          text("cta_texts").array(),
  techStack:         text("tech_stack").array(),
  wordCount:         integer("word_count"),
  pageCount:         integer("page_count"),

  // Core Web Vitals (PageSpeed Insights)
  lcpMs:             real("lcp_ms"),
  clsScore:          real("cls_score"),
  fidMs:             real("fid_ms"),
  mobileScore:       real("mobile_score"),
  desktopPerfScore:  real("desktop_perf_score"),  // NEW: for mobile/desktop gap detection

  brokenLinks:       text("broken_links").array(),
  hasSitemap:        boolean("has_sitemap"),
  robotsPolicy:      text("robots_policy"),
  screenshotPath:    text("screenshot_path"),

  // NEW: Orphan-page detection — same-domain <a href> targets scraped from cheerio
  internalLinks:     text("internal_links").array(),

  // NEW: Image accessibility
  imageTotal:        integer("image_total").default(0),
  imageAltMissing:   integer("image_alt_missing").default(0),

  // NEW: Technical signals
  hasHttpsRedirect:  boolean("has_https_redirect"),
  analyticsDetected: boolean("analytics_detected").default(false),
  hasSchemaJsonld:   boolean("has_schema_jsonld").default(false),
  hasCanonical:      boolean("has_canonical").default(false),

  // NEW: GEO / AI-crawler readability
  jsRenderedPct:     real("js_rendered_pct"),   // 0.0–1.0; higher = worse for AI crawlers
  pageWeightKb:      real("page_weight_kb"),    // total downloadable weight in KB
});

// ---------------------------------------------------------------------------
// 3. Competitor — mutable parent (config), append-only scans below
// ---------------------------------------------------------------------------

export const competitors = pgTable("competitors", {
  id:                text("id").primaryKey(),
  startupId:         text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:    text("idempotency_key").unique(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  name:              text("name").notNull(),
  url:               text("url").notNull(),
  heroCopy:          text("hero_copy"),
  positioningAngle:  text("positioning_angle"),
  pricingModel:      text("pricing_model"),
  pricingTiers:      text("pricing_tiers").array(),
  features:          text("features").array(),
  detectedAt:        timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CompetitorScan — weekly snapshot, append-only */
export const competitorScans = pgTable("competitor_scans", {
  id:                text("id").primaryKey(),
  competitorId:      text("competitor_id").notNull().references(() => competitors.id),
  startupId:         text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:    text("idempotency_key").unique(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  heroCopyHash:      text("hero_copy_hash"),
  pricingHash:       text("pricing_hash"),
  changeDetected:    boolean("change_detected").default(false),
  changeNotes:       text("change_notes"),
});

// ---------------------------------------------------------------------------
// 4. Keyword — append-only
// ---------------------------------------------------------------------------

export const keywords = pgTable("keywords", {
  id:                    text("id").primaryKey(),
  startupId:             text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:        text("idempotency_key").unique(),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  term:                  text("term").notNull(),
  searchVolume:          integer("search_volume"),
  keywordDifficulty:     real("keyword_difficulty"),
  startupRanking:        integer("startup_ranking"),
  competitorRankingsJson: text("competitor_rankings_json"),
  type:                  keywordTypeEnum("type").notNull().default("gap"),

  // NEW: data-source confidence for downstream scoring
  confidence:            keywordConfidenceEnum("confidence").notNull().default("serpapi_rank"),
  // NEW: # competitors using this term (for competitive_gap type)
  competitorCount:       integer("competitor_count").notNull().default(0),
  // NEW: prior week's ranking snapshot (for content_decay detection)
  priorRanking:          integer("prior_ranking"),
  priorRankingWeek:      text("prior_ranking_week"),  // ISO week e.g. '2026-W28'
});

// ---------------------------------------------------------------------------
// 5. Metric — append-only (never UPDATE, always INSERT)
// ---------------------------------------------------------------------------

export const metrics = pgTable("metrics", {
  id:             text("id").primaryKey(),
  startupId:      text("startup_id").notNull().references(() => startups.id),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  type:           metricTypeEnum("type").notNull(),
  value:          real("value").notNull(),
  date:           text("date").notNull(),             // YYYY-MM-DD
  source:         metricSourceEnum("source").notNull(),
});

// ---------------------------------------------------------------------------
// 6. Recommendation — append-only
// ---------------------------------------------------------------------------

export const recommendations = pgTable("recommendations", {
  id:                  text("id").primaryKey(),
  startupId:           text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:      text("idempotency_key").unique(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  category:            text("category").notNull(),
  title:               text("title").notNull(),
  description:         text("description").notNull(),
  evidenceFactIds:     text("evidence_fact_ids").array().notNull(), // at least one required
  targetMetric:        text("target_metric"),

  impactScore:         real("impact_score").notNull(),
  confidenceScore:     real("confidence_score").notNull(),
  effortScore:         real("effort_score").notNull(),
  priorityScore:       real("priority_score").notNull(),

  status:              recStatusEnum("status").notNull().default("pending"),
  trustLevelRequired:  integer("trust_level_required").notNull().default(1),
});

// ---------------------------------------------------------------------------
// 7. ContentDraft — append-only
// ---------------------------------------------------------------------------

export const contentDrafts = pgTable("content_drafts", {
  id:               text("id").primaryKey(),
  startupId:        text("startup_id").notNull().references(() => startups.id),
  recommendationId: text("recommendation_id").notNull().references(() => recommendations.id),
  idempotencyKey:   text("idempotency_key").unique(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  type:             contentTypeEnum("type").notNull(),
  content:          text("content").notNull(),
  status:           contentStatusEnum("status").notNull().default("pending_approval"),
  publishedUrl:     text("published_url"),
});

// ---------------------------------------------------------------------------
// 8. Integration — mutable (OAuth tokens rotate)
// ---------------------------------------------------------------------------

export const integrations = pgTable("integrations", {
  id:              text("id").primaryKey(),
  startupId:       text("startup_id").notNull().references(() => startups.id),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  type:            integrationTypeEnum("type").notNull(),
  connected:       boolean("connected").notNull().default(false),
  accessToken:     text("access_token"),               // encrypted at rest
  refreshToken:    text("refresh_token"),              // encrypted at rest
  scopesJson:      text("scopes_json"),                // JSON string: string[]
  connectedAt:     timestamp("connected_at", { withTimezone: true }),
  lastSyncedAt:    timestamp("last_synced_at", { withTimezone: true }),
  connectionHealth: connectionHealthEnum("connection_health").notNull().default("ok"),
});

// ---------------------------------------------------------------------------
// 9. FeedbackSignal — append-only
// ---------------------------------------------------------------------------

export const feedbackSignals = pgTable("feedback_signals", {
  id:                text("id").primaryKey(),
  startupId:         text("startup_id").notNull().references(() => startups.id),
  recommendationId:  text("recommendation_id").notNull().references(() => recommendations.id),
  idempotencyKey:    text("idempotency_key").unique(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  action:            feedbackActionEnum("action").notNull(),
  editDeltaChars:    integer("edit_delta_chars").default(0),
  category:          text("category").notNull(),
  outcomeMetricId:   text("outcome_metric_id"),        // linked after 30 days
});

// ---------------------------------------------------------------------------
// 10. BrandVoice — mutable (founders can update)
// ---------------------------------------------------------------------------

export const brandVoices = pgTable("brand_voices", {
  id:         text("id").primaryKey(),
  startupId:  text("startup_id").notNull().references(() => startups.id),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  examplesJson: text("examples_json").notNull(),       // JSON string: string[]
  tone:         text("tone"),
  avoidJson:    text("avoid_json"),                    // JSON string: string[]
  source:       brandVoiceSourceEnum("source").notNull().default("onboarding_questionnaire"),
});

// ---------------------------------------------------------------------------
// 11. TelemetryEvent — append-only, powers product KPI dashboards
// ---------------------------------------------------------------------------

export const telemetryEvents = pgTable("telemetry_events", {
  id:          text("id").primaryKey(),
  startupId:   text("startup_id").notNull().references(() => startups.id),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  event:       telemetryEventEnum("event").notNull(),
  metadataJson: text("metadata_json"),                 // JSON string: Record<string, unknown>
});

// ---------------------------------------------------------------------------
// 12. Customer / Segment — schema-ready; CUSTOMER_FEEDBACK_AGENT is deferred
// ---------------------------------------------------------------------------

export const customers = pgTable("customers", {
  id:              text("id").primaryKey(),
  startupId:       text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:  text("idempotency_key").unique(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  segmentName:     text("segment_name"),
  source:          text("source"),                     // "hubspot" | "support_tool" | "manual"
  sentimentScore:  real("sentiment_score"),
  churnRiskScore:  real("churn_risk_score"),
});

// ---------------------------------------------------------------------------
// 13. MarketSignal — schema-ready; MARKET_SIGNAL_AGENT is deferred
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 15. AgentFailure — append-only error log; written by every agent on catch
// ---------------------------------------------------------------------------

export const agentFailures = pgTable("agent_failures", {
  id:           text("id").primaryKey(),
  startupId:    text("startup_id").notNull().references(() => startups.id),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  agentName:    text("agent_name").notNull(),
  errorMessage: text("error_message"),
  context:      text("context"),    // JSON — optional extra context bag
});

// ---------------------------------------------------------------------------
// 16. StripeEvent — append-only, Stripe event ID is the PK (already globally unique)
// ---------------------------------------------------------------------------

export const stripeEvents = pgTable("stripe_events", {
  id:          text("id").primaryKey(),            // Stripe event ID (e.g. evt_xxx)
  startupId:   text("startup_id").notNull().references(() => startups.id),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  eventType:   text("event_type").notNull(),
  severity:    text("severity").notNull(),           // "HIGH" | "INFO"
  customerId:  text("customer_id"),
  amount:      real("amount"),
  rawJson:     text("raw_json"),                     // full Stripe event payload
});

export const marketSignals = pgTable("market_signals", {
  id:                     text("id").primaryKey(),
  startupId:              text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:         text("idempotency_key").unique(),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  tamEstimate:            real("tam_estimate"),
  categoryTrendDirection: text("category_trend_direction"), // "up" | "flat" | "down"
  source:                 text("source"),
});

// ---------------------------------------------------------------------------
// 14. OutcomeRecord — append-only, written 30 days after execution
// ---------------------------------------------------------------------------

export const outcomeRecords = pgTable("outcome_records", {
  id:                   text("id").primaryKey(),
  startupId:            text("startup_id").notNull().references(() => startups.id),
  recommendationId:     text("recommendation_id").notNull().references(() => recommendations.id),
  idempotencyKey:       text("idempotency_key").unique(),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  metricType:           text("metric_type").notNull(),
  beforeValue:          real("before_value").notNull(),
  afterValue:           real("after_value").notNull(),
  changePct:            real("change_pct").notNull(),
  recommendationWorked: boolean("recommendation_worked").notNull(),
});

// ---------------------------------------------------------------------------
// 17. Alert — append-only; written by anomaly-detector, never mutated
// ---------------------------------------------------------------------------

export const alertSeverityEnum = pgEnum("alert_severity", ["critical", "warning", "info"]);
export const alertChannelEnum  = pgEnum("alert_channel",  ["email", "toast", "both"]);

// ---------------------------------------------------------------------------
// 18. SeoAudit — cached SEOScoreAPI results (rate-limit-aware, 7-day cache)
// ---------------------------------------------------------------------------

export const seoAudits = pgTable("seo_audits", {
  id:             text("id").primaryKey(),
  startupId:      text("startup_id").notNull().references(() => startups.id),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  url:            text("url").notNull(),
  /** sha256(title + metaDescription + h1 + wordCount) — detects content changes */
  contentHash:    text("content_hash").notNull(),
  score:          real("score").notNull().default(0),
  grade:          text("grade").notNull().default("N/A"),
  /** Full normalized SeoScoreAuditResult stored as JSON string */
  rawJson:        text("raw_json").notNull(),
});

// ---------------------------------------------------------------------------
// 19. SeoAuditCallCounter — daily rate-limit tracker (2/day on free plan)
// ---------------------------------------------------------------------------

export const seoAuditCallCounter = pgTable("seo_audit_call_counter", {
  id:        text("id").primaryKey(),
  callDate:  text("call_date").notNull().unique(),  // YYYY-MM-DD
  callCount: integer("call_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 20. GeoScore — GEO (Generative Engine Optimization) score, displayed
//     separately from traditional SEO health on the dashboard
// ---------------------------------------------------------------------------

export const geoScores = pgTable("geo_scores", {
  id:                 text("id").primaryKey(),
  startupId:          text("startup_id").notNull().references(() => startups.id),
  scanId:             text("scan_id").references(() => websiteScans.id),
  idempotencyKey:     text("idempotency_key").unique(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  overallGeoScore:    real("overall_geo_score").notNull().default(0),  // 0-100
  llmsTxtScore:       real("llms_txt_score").notNull().default(0),
  schemaJsonldScore:  real("schema_jsonld_score").notNull().default(0),
  jsRenderScore:      real("js_render_score").notNull().default(0),
  aiReadabilityScore: real("ai_readability_score").notNull().default(0),
});

export const alerts = pgTable("alerts", {
  id:              text("id").primaryKey(),
  startupId:       text("startup_id").notNull().references(() => startups.id),
  idempotencyKey:  text("idempotency_key").unique(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  metricType:      text("metric_type").notNull(),
  zScore:          real("z_score").notNull(),
  severity:        alertSeverityEnum("severity").notNull().default("warning"),
  channel:         alertChannelEnum("channel").notNull().default("both"),
  message:         text("message").notNull(),
  emailSentAt:     timestamp("email_sent_at", { withTimezone: true }),
  acknowledged:    boolean("acknowledged").notNull().default(false),
  /** 'zscore_batch' | 'stripe_realtime' — stripe alerts bypass the daily batch job */
  source:          text("source").notNull().default("zscore_batch"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 21. PositioningGap — persisted output of POSITIONING_GAP_AGENT
// ---------------------------------------------------------------------------

export const positioningGaps = pgTable("positioning_gaps", {
  id:             text("id").primaryKey(),
  startupId:      text("startup_id").notNull().references(() => startups.id),
  competitorId:   text("competitor_id").references(() => competitors.id),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  gapDescription: text("gap_description").notNull(),
  opportunity:    text("opportunity"),
  confidence:     real("confidence").default(0.7),
});
