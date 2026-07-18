/**
 * Trust Ladder — exact spec §7 implementation.
 *
 * get_trust_level(startupId, category):
 *   signals = get_feedback_signals(startup_id, category)
 *   approved = [s for s in signals if s.action == "approved"]
 *   acceptance_rate = len(approved) / max(len(signals), 1)
 *   if len(approved) >= 15 and acceptance_rate > 0.8: return 4
 *   if len(approved) >= 5  and acceptance_rate > 0.7: return 3
 *   if len(approved) >= 2:                            return 2
 *   return 1
 *
 * Pure computation exported for unit tests; DB read separated into
 * getTrustLevel() which is the function callers use.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { feedbackSignals } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Level descriptions (mirrors the UI trustLadderDetails constant)
// ---------------------------------------------------------------------------

export const TRUST_LEVELS = {
  1: "suggest_only",
  2: "draft_dont_send",
  3: "execute_confirm",
  4: "autonomous",
} as const;

export type TrustLevel = 1 | 2 | 3 | 4;

export const TRUST_CATEGORIES = [
  "seo_metadata",
  "content_blog",
  "content_social",
  "landing_page",
  "email_outreach",
  "pricing",
] as const;

// ---------------------------------------------------------------------------
// Pure computation — exported for unit tests
// ---------------------------------------------------------------------------

export function computeTrustLevel(
  approvedCount: number,
  totalCount: number,
): TrustLevel {
  const acceptanceRate = approvedCount / Math.max(totalCount, 1);
  if (approvedCount >= 15 && acceptanceRate > 0.8) return 4;
  if (approvedCount >= 5  && acceptanceRate > 0.7) return 3;
  if (approvedCount >= 2)                          return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// DB read — used by ExecutionGate and API routes
// ---------------------------------------------------------------------------

export async function getTrustLevel(
  startupId: string,
  category: string,
): Promise<TrustLevel> {
  const signals = await db
    .select({ action: feedbackSignals.action })
    .from(feedbackSignals)
    .where(
      and(
        eq(feedbackSignals.startupId, startupId),
        eq(feedbackSignals.category, category),
      ),
    );

  const approvedCount = signals.filter((s) => s.action === "approved").length;
  return computeTrustLevel(approvedCount, signals.length);
}

// ---------------------------------------------------------------------------
// adjustWeights — update the startup's recommendation weight model based on
// the new feedback signal. Currently a no-op placeholder; when the scoring
// layer grows confidence calibration (v2), this is where it lands.
//
// Called by every approve / edit / ignore route so the call site is already
// in place — swapping in real weight adjustment doesn't require touching routes.
// ---------------------------------------------------------------------------

export async function adjustWeights(
  startupId: string,
  category: string,
  action: "approved" | "edited" | "ignored",
): Promise<void> {
  // v1: telemetry only — real Bayesian weight update lives in Phase 3
  console.info(
    `[trust-ladder] adjustWeights: startupId=${startupId} category=${category} action=${action}`,
  );
}
