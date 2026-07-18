/**
 * MODEL_ROUTES — maps each agent step to (primary, fallback) OpenRouter model IDs.
 * All calls go through OpenRouter: https://openrouter.ai/api/v1/chat/completions
 * using the single OPENROUTER_API_KEY environment variable.
 */

export const MODEL_ROUTES: Record<string, [primary: string, fallback: string]> = {
  brief_skeleton:          ["qwen/qwen3-coder:free",               "openai/gpt-oss-120b:free"],
  differentiation_check:   ["deepseek/deepseek-v4-flash:free",     "meta-llama/llama-4-maverick:free"],
  seo_recommendation:      ["deepseek/deepseek-v4-flash:free",     "openai/gpt-oss-120b:free"],
  competitor_gap_analysis: ["deepseek/deepseek-v4-flash:free",     "openai/gpt-oss-120b:free"],
  blog_final_draft:        ["meta-llama/llama-4-maverick:free",    "deepseek/deepseek-v4-flash:free"],
  social_draft:            ["deepseek/deepseek-v4-flash:free",     "meta-llama/llama-4-maverick:free"],
  daily_anomaly_summary:   ["meta-llama/llama-3.3-70b:free",      "openai/gpt-oss-120b:free"],
  long_horizon_seo_audit:  ["openai/gpt-oss-120b:free",           "deepseek/deepseek-v4-flash:free"],
  classification_routing:  ["qwen/qwen3-coder:free",               "openai/gpt-oss-120b:free"],
};

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
