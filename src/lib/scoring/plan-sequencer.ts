/**
 * 30-Day Plan Sequencer — exact spec §6 implementation.
 *
 * The spec's algorithm (verbatim):
 *   for week in [1, 2, 3, 4]:
 *     for rec in ranked_recommendations:
 *       deps = DEPENDENCIES.get(rec.category, [])
 *       if all(dep in completed or dep in get_week_items(plan_weeks, week-1) for dep in deps):
 *         plan_weeks[week].append(rec)
 *         if len(plan_weeks[week]) >= 3: break
 *
 * Note: the spec checks get_week_items(plan_weeks, week-1) — previous week only.
 * A dependency satisfied two weeks ago is still counted because 'completed'
 * includes all executed/approved actions from DB history.
 *
 * Pure function — exported for unit tests. No DB writes, no LLM calls.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";
import type { RankedRecommendation } from "./recommendation-engine";

// ---------------------------------------------------------------------------
// DEPENDENCIES — exact spec §6 map
// ---------------------------------------------------------------------------

export const DEPENDENCIES: Record<string, string[]> = {
  product_hunt_launch: ["landing_page_copy", "meta_description"],
  seo_blog_posts:      ["tech_seo_fixes"],
  ab_test_onboarding:  ["has_analytics_goal_configured"],
  paid_ads:            ["landing_page_copy", "conversion_tracking"],
  linkedin_content:    ["brand_voice_defined"],
};

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface ThirtyDayPlan {
  1: RankedRecommendation[];
  2: RankedRecommendation[];
  3: RankedRecommendation[];
  4: RankedRecommendation[];
}

// ---------------------------------------------------------------------------
// Exported pure function — unit-testable
// ---------------------------------------------------------------------------

/**
 * build30DayPlanPure — the spec algorithm as a pure function.
 *
 * @param ranked       Already-sorted recommendations (highest priority first)
 * @param completed    Set of category strings already executed / approved in DB history
 */
export function build30DayPlanPure(
  ranked: RankedRecommendation[],
  completed: Set<string>,
): ThirtyDayPlan {
  const plan: ThirtyDayPlan = { 1: [], 2: [], 3: [], 4: [] };

  for (const week of [1, 2, 3, 4] as const) {
    // BUG-2 FIX: week=1 has no prior week — use empty array, not plan[1] (which is currently being built)
    const prevWeekItems = week === 1 ? [] : plan[(week - 1) as 2 | 3 | 4];
    const prevWeekCategories = new Set(prevWeekItems.map((r) => r.category));


    for (const rec of ranked) {
      if (plan[week].length >= 3) break;

      // Skip recs already assigned to an earlier week
      const alreadyAssigned = (
        plan[1].includes(rec) ||
        plan[2].includes(rec) ||
        plan[3].includes(rec) ||
        plan[4].includes(rec)
      );
      if (alreadyAssigned) continue;

      const deps = DEPENDENCIES[rec.category] ?? [];
      const depsSatisfied = deps.every(
        // spec: dep in completed OR dep in get_week_items(plan_weeks, week-1)
        (dep) => completed.has(dep) || prevWeekCategories.has(dep),
      );

      if (depsSatisfied) {
        plan[week].push(rec);
      }
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Main export — loads completed set from DB, delegates to pure function
// ---------------------------------------------------------------------------

export async function build30DayPlan(
  ranked: RankedRecommendation[],
  startupId: string,
): Promise<ThirtyDayPlan> {
  // completed = categories with status executed or approved
  const completedRows = await db
    .select({ category: recommendations.category, status: recommendations.status })
    .from(recommendations)
    .where(eq(recommendations.startupId, startupId));

  const completed = new Set(
    completedRows
      .filter((r) => r.status === "executed" || r.status === "approved")
      .map((r) => r.category)
      .filter((c): c is string => !!c),
  );

  return build30DayPlanPure(ranked, completed);
}
