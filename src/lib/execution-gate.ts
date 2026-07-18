/**
 * ExecutionGate — the ONLY choke point for side-effecting actions (spec §7).
 *
 * Rules verbatim from spec:
 *   IRREVERSIBLE = {"email_customers", "change_pricing", "publish_content", "delete_data"}
 *   AUTO_SAFE    = {"seo_metadata", "monitoring_report"}
 *
 * content_social and content_blog are ALWAYS action_risk="publish_content" —
 * always in IRREVERSIBLE. This is hardcoded (spec note under §7 code block):
 *   "a founder never gets auto-published content, even at trust level 4,
 *    until that's a deliberate future decision (a change to AUTO_SAFE,
 *    reviewed on its own)."
 * Do NOT make this configurable via env var or DB — it must stay a code change.
 *
 * execute_action algorithm:
 *   trust = getTrustLevel(startupId, category)
 *   if action_risk in IRREVERSIBLE and trust < 3: raise ExecutionBlocked
 *   if trust == 4 and category in AUTO_SAFE: return action_fn()
 *   return queue_for_confirmation(action_fn, args)
 */

import { getTrustLevel } from "@/lib/trust-ladder";
import type { TrustLevel } from "@/lib/trust-ladder";

// ---------------------------------------------------------------------------
// Constants — spec §7
// ---------------------------------------------------------------------------

/** Actions that can never be un-done. Requires trust level ≥ 3. */
export const IRREVERSIBLE = new Set([
  "email_customers",
  "change_pricing",
  "publish_content",
  "delete_data",
] as const);

/**
 * Categories that MAY run autonomously at trust level 4.
 * content_social and content_blog are intentionally absent — they always
 * use action_risk="publish_content" and therefore always require trust ≥ 3
 * AND always go through confirmation (never AUTO_SAFE).
 */
export const AUTO_SAFE = new Set([
  "seo_metadata",
  "monitoring_report",
] as const);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ExecutionBlocked extends Error {
  constructor(
    public readonly category: string,
    public readonly actionRisk: string,
    public readonly currentTrustLevel: TrustLevel,
  ) {
    super(
      `ExecutionGate: irreversible action "${actionRisk}" in category "${category}" ` +
      `blocked — requires trust level 3+, current level is ${currentTrustLevel}.`,
    );
    this.name = "ExecutionBlocked";
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type GateOutcome<T> =
  | { dispatched: "direct";       result: T }
  | { dispatched: "confirmation"; queuedAt: Date };

// ---------------------------------------------------------------------------
// ExecutionGate
// ---------------------------------------------------------------------------

export class ExecutionGate {
  /**
   * execute_action — the single choke point.
   *
   * @param startupId    Identifies the startup (used to look up trust level)
   * @param category     Matches TRUST_CATEGORIES (e.g. "seo_metadata", "content_blog")
   * @param actionRisk   The risk class of the action (see IRREVERSIBLE / AUTO_SAFE)
   * @param actionFn     The async side-effect to run (if allowed)
   */
  async executeAction<T>(
    startupId: string,
    category: string,
    actionRisk: string,
    actionFn: () => Promise<T>,
  ): Promise<GateOutcome<T>> {
    const trust = await getTrustLevel(startupId, category);

    // Block irreversible actions below trust level 3
    if (IRREVERSIBLE.has(actionRisk as never) && trust < 3) {
      throw new ExecutionBlocked(category, actionRisk, trust);
    }

    // At trust level 4 in an AUTO_SAFE category → run directly
    if (trust === 4 && AUTO_SAFE.has(category as never)) {
      const result = await actionFn();
      return { dispatched: "direct", result };
    }

    // All other cases → queue for founder confirmation (write to DB, never execute inline)
    // The actual queueing mechanism is a ContentDraft row with status=pending_approval.
    // The action_fn is NOT called here — the founder approves it from the dashboard.
    return { dispatched: "confirmation", queuedAt: new Date() };
  }
}

/** Singleton — import this; don't construct new ExecutionGate() in route files. */
export const executionGate = new ExecutionGate();
