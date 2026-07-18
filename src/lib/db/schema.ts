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

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const startupStageEnum = pgEnum("startup_stage", ["idea", "mvp", "growth"]);
export const primaryGoalEnum  = pgEnum("primary_goal",  ["get_more_customers", "retain_existing_customers"]);
export const metricTypeEnum   = pgEnum("metric_type",   ["sessions", "conversions", "mrr", "churn_rate", "ltv"]);
export const metricSourceEnum = pgEnum("metric_source", ["ga4", "stripe", "posthog", "manual"]);
export const recStatusEnum    = pgEnum("rec_status",    ["pending", "approved", "edited", "ignored", "executed"]);
export const contentTypeEnum  = pgEnum("content_type",  ["blog", "linkedin", "facebook", "meta_tag", "landing_page_copy"]);
export const contentStatusEnum = pgEnum("content_status", ["pending_approval", "approved", "published", "rejected"]);
export const integrationTypeEnum = pgEnum("integration_type", ["ga4", "gsc", "stripe", "posthog", "hubspot", "github", "clarity"]);
export const connectionHealthEnum = pgEnum("connection_health", ["ok", "expired", "error"]);
export const feedbackActionEnum = pgEnum("feedback_action", ["approved", "edited", "ignored"]);
export const brandVoiceSourceEnum = pgEnum("brand_voice_source", ["onboarding_questionnaire", "existing_content_sample"]);
export const keywordTypeEnum = pgEnum("keyword_type", ["owned", "gap", "opportunity"]);
export const telemetryEventEnum = pgEnum("telemetry_event", [
  "signup_started",
  "report_delivered",
  "integration_connected",
  "plan_item_approved",
  "plan_item_ignored",
  "briefing_viewed",
  "outcome_recorded",
]);

// ---------------------------------------------------------------------------
// 1. Startup — mutable root entity (config, not a fact)
// ---------------------------------------------------------------------------

export const startups = pgTable("startups", {
  id:           text("id").primaryKey(),                    // ULID
  name:         text("name").notNull(),
  url:          text("url"),
  industry:     text("industry"),
  stage:        startupStageEnum("stage").notNull().default("mvp"),
  country:      text("country"),
  primaryGoal:  primaryGoalEnum("primary_goal").notNull().default("get_more_customers"),
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
  title:             text("title"),
  metaDescription:   text("meta_description"),
  h1:                text("h1"),
  heroCopy:          text("hero_copy"),
  ctaTexts:          text("cta_texts").array(),
  techStack:         text("tech_stack").array(),
  wordCount:         integer("word_count"),
  pageCount:         integer("page_count"),

  lcpMs:             real("lcp_ms"),
  clsScore:          real("cls_score"),
  fidMs:             real("fid_ms"),
  mobileScore:       real("mobile_score"),

  brokenLinks:       text("broken_links").array(),
  hasSitemap:        boolean("has_sitemap"),
  robotsPolicy:      text("robots_policy"),
  screenshotPath:    text("screenshot_path"),
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
  competitorRankingsJson: text("competitor_rankings_json"), // JSON string: { [competitorId]: rank }
  type:                  keywordTypeEnum("type").notNull().default("gap"),
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

export const alerts = pgTable("alerts", {
  id:           text("id").primaryKey(),             // ULID
  startupId:    text("startup_id").notNull().references(() => startups.id),
  idempotencyKey: text("idempotency_key").unique(),  // prevents duplicate alerts same day
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  metricType:   text("metric_type").notNull(),       // "sessions" | "conversions" | "mrr"
  zScore:       real("z_score").notNull(),           // computed z-score (negative = drop)
  severity:     alertSeverityEnum("severity").notNull().default("warning"),
  channel:      alertChannelEnum("channel").notNull().default("both"),
  message:      text("message").notNull(),
  emailSentAt:  timestamp("email_sent_at", { withTimezone: true }),
  acknowledged: boolean("acknowledged").notNull().default(false),
});

