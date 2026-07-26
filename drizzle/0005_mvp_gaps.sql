-- =============================================================================
-- Migration 0005: MVP functionality gaps
-- Adds: alerts.source, alerts.acknowledged_at, positioning_gaps table
-- =============================================================================

-- 1. Add source + acknowledged_at to alerts
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'zscore_batch',
  -- Values: 'zscore_batch' | 'stripe_realtime'
  ADD COLUMN IF NOT EXISTS acknowledged_at  timestamptz;

-- 2. positioning_gaps — stores LLM-generated positioning analysis
CREATE TABLE IF NOT EXISTS positioning_gaps (
  id              text PRIMARY KEY,
  startup_id      text NOT NULL REFERENCES startups(id),
  competitor_id   text REFERENCES competitors(id),
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),

  gap_description text NOT NULL,    -- what angle competitors use that startup misses
  opportunity     text,             -- concrete differentiation action
  confidence      real DEFAULT 0.7  -- 0-1; higher = more competitors exhibit this pattern
);

CREATE INDEX IF NOT EXISTS positioning_gaps_startup
  ON positioning_gaps (startup_id, created_at DESC);

-- 3. Add country to startups (if not already present from earlier migrations)
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS country text;
