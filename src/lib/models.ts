/**
 * MODEL_ROUTES — maps each agent step to (primary, fallback) OpenRouter model IDs.
 * All calls go through OpenRouter: https://openrouter.ai/api/v1/chat/completions
 *
 * Primary:  openrouter/auto  → OpenRouter picks the best free model available at runtime
 * Fallback: google/gemma-3-27b-it:free → reliable free model as safety net
 *
 * Note: "openrouter/free" is deprecated — use "openrouter/auto" instead.
 */

export const MODEL_ROUTES: Record<string, [primary: string, fallback: string]> = {
  brief_skeleton:          ["openrouter/auto", "google/gemma-3-27b-it:free"],
  differentiation_check:   ["openrouter/auto", "google/gemma-3-27b-it:free"],
  seo_recommendation:      ["openrouter/auto", "google/gemma-3-27b-it:free"],
  competitor_gap_analysis: ["openrouter/auto", "google/gemma-3-27b-it:free"],
  blog_final_draft:        ["openrouter/auto", "google/gemma-3-27b-it:free"],
  social_draft:            ["openrouter/auto", "google/gemma-3-27b-it:free"],
  daily_anomaly_summary:   ["openrouter/auto", "google/gemma-3-27b-it:free"],
  long_horizon_seo_audit:  ["openrouter/auto", "google/gemma-3-27b-it:free"],
  classification_routing:  ["openrouter/auto", "google/gemma-3-27b-it:free"],
};

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
