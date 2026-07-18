/**
 * logEvent — writes a TelemetryEvent row to the knowledge graph.
 *
 * Call sites: wherever the spec says log_event(). One extra line at
 * existing onboarding call sites — no separate analytics system needed.
 *
 * Telemetry events tracked (from spec §10):
 *   signup_started       → measures time-to-report when paired with report_delivered
 *   report_delivered     → signals onboarding completion
 *   integration_connected → tracks % of startups connecting ≥1 tool
 *   plan_item_approved   → numerator for approval rate
 *   plan_item_ignored    → denominator contribution for approval rate
 *   briefing_viewed      → week-1+ retention signal
 *   outcome_recorded     → 30-day metric-moved rate
 */

import { db } from "./db/client";
import { telemetryEvents } from "./db/schema";
import { generateULID } from "./ulid";

export type TelemetryEventName =
  | "signup_started"
  | "report_delivered"
  | "integration_connected"
  | "plan_item_approved"
  | "plan_item_ignored"
  | "briefing_viewed"
  | "outcome_recorded";

export async function logEvent(
  startupId: string,
  event: TelemetryEventName,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(telemetryEvents).values({
    id:           generateULID(),
    startupId,
    event,
    metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
  });
}
