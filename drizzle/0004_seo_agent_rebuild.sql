-- =============================================================================
-- Migration: SEO Agent System Rebuild
-- Created: 2026-07-26
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add seo_maturity field to startups
-- -----------------------------------------------------------------------------
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS seo_maturity text DEFAULT 'unknown';
  -- Values: 'unknown' | 'cold_start' | 'emerging' | 'established'

-- -----------------------------------------------------------------------------
-- 2. Add new columns to keywords
-- -----------------------------------------------------------------------------
ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS confidence text DEFAULT 'serpapi_rank',
  -- Values: 'gsc' | 'serpapi_rank' | 'competitor_inferred'
  ADD COLUMN IF NOT EXISTS competitor_count integer DEFAULT 0,
  -- Number of competitors using this term (for competitive_gap type)
  ADD COLUMN IF NOT EXISTS prior_ranking integer,
  -- Previous week's ranking (for content_decay detection)
  ADD COLUMN IF NOT EXISTS prior_ranking_week text;
  -- ISO week of prior_ranking snapshot, e.g. '2026-W28'

-- Add competitive_gap to the keyword_type enum
-- NOTE: Postgres enums cannot be altered in-place easily; use a new allowed value
ALTER TYPE keyword_type ADD VALUE IF NOT EXISTS 'competitive_gap';

-- -----------------------------------------------------------------------------
-- 3. Add internal_links to website_scans (for orphan_page_risk detection)
-- -----------------------------------------------------------------------------
ALTER TABLE website_scans
  ADD COLUMN IF NOT EXISTS internal_links text[],
  -- Array of same-domain hrefs scraped from <a> tags (no extra network calls)
  ADD COLUMN IF NOT EXISTS image_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_alt_missing integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_https_redirect boolean,
  ADD COLUMN IF NOT EXISTS analytics_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS js_rendered_pct real,
  -- 0.0-1.0: fraction of content only present post-JS execution
  ADD COLUMN IF NOT EXISTS page_weight_kb real,
  -- Total downloadable page weight in KB
  ADD COLUMN IF NOT EXISTS desktop_perf_score real,
  -- PageSpeed desktop score (0-100)
  ADD COLUMN IF NOT EXISTS has_schema_jsonld boolean DEFAULT false,
  -- JSON-LD structured data present
  ADD COLUMN IF NOT EXISTS has_canonical boolean DEFAULT false;

-- -----------------------------------------------------------------------------
-- 4. seo_audits — cache table for SEOScoreAPI results
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo_audits (
  id               text PRIMARY KEY,
  startup_id       text NOT NULL REFERENCES startups(id),
  url              text NOT NULL,
  content_hash     text NOT NULL,
  -- sha256 of (title || meta_description || h1 || word_count::text)
  score            real NOT NULL DEFAULT 0,
  grade            text NOT NULL DEFAULT 'N/A',
  raw_json         text NOT NULL,
  -- Full normalized SeoScoreAuditResult JSON
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_audits_startup_url
  ON seo_audits (startup_id, url, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. seo_audit_call_counter — daily rate-limit tracker
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo_audit_call_counter (
  id           text PRIMARY KEY,
  call_date    text NOT NULL UNIQUE,  -- YYYY-MM-DD
  call_count   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6. geo_scores — stores per-startup GEO (Generative Engine Optimization) score
--    Kept separate from health_scores so dashboard can display it independently
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_scores (
  id                   text PRIMARY KEY,
  startup_id           text NOT NULL REFERENCES startups(id),
  scan_id              text REFERENCES website_scans(id),
  created_at           timestamptz NOT NULL DEFAULT now(),

  overall_geo_score    real NOT NULL DEFAULT 0,
  -- 0-100 composite

  llms_txt_score       real NOT NULL DEFAULT 0,
  -- 100 if present, 0 if missing
  schema_jsonld_score  real NOT NULL DEFAULT 0,
  -- 100 if valid JSON-LD present, 50 if partial, 0 if missing
  js_render_score      real NOT NULL DEFAULT 0,
  -- 100 * (1 - js_rendered_pct): lower JS = better for AI crawlers
  ai_readability_score real NOT NULL DEFAULT 0,
  -- Passed through from SEOScoreAPI ai_readability_score if available

  idempotency_key      text UNIQUE
);

CREATE INDEX IF NOT EXISTS geo_scores_startup
  ON geo_scores (startup_id, created_at DESC);
