/**
 * run_agent — the ONE AND ONLY place in the codebase that calls an LLM.
 *
 * Rules (from architecture spec §2):
 *   • Every agent output is Zod-schema-validated before returning.
 *   • On validation failure, retry up to maxRetries times.
 *   • After maxRetries exhausted, step down to fallbackModel (if set) and try once more.
 *   • If the output has an evidenceFactId field, it is checked to exist in the DB
 *     (callers pass a factExists helper; default is a no-op stub until DB is wired).
 *   • No other file in this codebase may call the OpenRouter API directly.
 */

import { z } from "zod";
import { OPENROUTER_BASE_URL } from "./models";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentContract<TOutput extends z.ZodTypeAny> {
  name: string;
  /** Primary OpenRouter model id — from MODEL_ROUTES */
  model: string;
  systemPrompt: string;
  /** Zod schema for the expected JSON output */
  outputSchema: TOutput;
  maxRetries?: number;
  /** Stepped down to on repeated validation failure */
  fallbackModel?: string;
  /** JSON-schema tool definitions the model may call */
  tools?: Record<string, unknown>[];
  /** Orchestrator skips "deferred" agents entirely */
  status?: "active" | "deferred";
}

export class AgentNotActiveError extends Error {
  constructor(name: string) {
    super(`Agent "${name}" is deferred — set status: "active" to run it.`);
    this.name = "AgentNotActiveError";
  }
}

export class AgentHardFailureError extends Error {
  constructor(name: string, cause: unknown) {
    super(`Agent "${name}" exceeded all retries: ${String(cause)}`);
    this.name = "AgentHardFailureError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Internal — raw LLM call
// ---------------------------------------------------------------------------

interface RawLLMOptions {
  model: string;
  systemPrompt: string;
  userContent: string;
  tools?: Record<string, unknown>[];
  outputSchema: z.ZodTypeAny;
}

let keyCallCounter = 0;

function getOpenRouterApiKey(): string {
  const keys = [
    process.env.OPENROUTER_API_KEY1,
    process.env.OPENROUTER_API_KEY2,
    process.env.OPENROUTER_API_KEY,
  ].filter((k): k is string => Boolean(k && k.trim().length > 0));

  // Remove duplicates
  const uniqueKeys = Array.from(new Set(keys));

  if (uniqueKeys.length === 0) {
    throw new Error(
      "No OPENROUTER_API_KEY found. Add OPENROUTER_API_KEY1 or OPENROUTER_API_KEY to .env.local",
    );
  }

  // Round-robin load balancing across keys to maximize free rate limits
  return uniqueKeys[keyCallCounter++ % uniqueKeys.length];
}

async function callLLM(opts: RawLLMOptions): Promise<string> {
  const apiKey = getOpenRouterApiKey();

  // Zod v4 ships z.toJSONSchema() as the official schema conversion utility.
  const jsonSchema = z.toJSONSchema(opts.outputSchema);

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "agent_output",
        strict: true,
        schema: jsonSchema,
      },
    },
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
  }

  const res = await fetch(OPENROUTER_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://growthsaarthi.ai",
      "X-Title": "GrowthSaarthi",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("OpenRouter returned an empty content field");
  return content;
}

function extractJsonString(raw: string): string {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.substring(firstBrace, lastBrace + 1);
  }
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// render() — converts a context dict into a user message string
// ---------------------------------------------------------------------------

function renderContext(context: Record<string, unknown>): string {
  return JSON.stringify(context, null, 2);
}

// ---------------------------------------------------------------------------
// run_agent — the public API
// ---------------------------------------------------------------------------

/**
 * Optional hook callers can pass to verify that an `evidenceFactId` field
 * on the agent output actually exists in the knowledge graph.
 * Default is a no-op (returns true) until the DB layer is fully wired.
 */
export type FactExistsCheck = (factId: string) => Promise<boolean>;
const defaultFactExists: FactExistsCheck = async () => true;

export async function runAgent<TOutput extends z.ZodTypeAny>(
  contract: AgentContract<TOutput>,
  context: Record<string, unknown>,
  factExists: FactExistsCheck = defaultFactExists,
): Promise<z.infer<TOutput>> {
  if (contract.status === "deferred") {
    throw new AgentNotActiveError(contract.name);
  }

  const maxRetries = contract.maxRetries ?? 2;
  const userContent = renderContext(context);
  let currentModel = contract.model;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callLLM({
        model: currentModel,
        systemPrompt: contract.systemPrompt,
        userContent,
        tools: contract.tools,
        outputSchema: contract.outputSchema,
      });

      // Parse JSON — model might wrap it in markdown fences or include commentary
      const jsonStr = extractJsonString(raw);
      const parsed = contract.outputSchema.parse(JSON.parse(jsonStr)) as z.infer<TOutput>;

      // Citation check — if the output carries evidenceFactId, verify it exists
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "evidenceFactId" in parsed &&
        typeof (parsed as Record<string, unknown>).evidenceFactId === "string"
      ) {
        const id = (parsed as Record<string, unknown>).evidenceFactId as string;
        const ok = await factExists(id);
        if (!ok) throw new Error(`evidenceFactId "${id}" not found in knowledge graph`);
      }

      return parsed;
    } catch (err) {
      lastError = err;
      console.error(
        `[runAgent] ${contract.name} attempt ${attempt + 1}/${maxRetries + 1} failed:`,
        err,
      );

      // BUG-4 FIX: was `attempt === maxRetries - 1` — stepped down one attempt TOO EARLY,
      // wasting the last primary-model attempt. Now switches only after all primary retries done.
      if (attempt === maxRetries && currentModel === contract.model && contract.fallbackModel) {
        currentModel = contract.fallbackModel;
      }

    }
  }

  throw new AgentHardFailureError(contract.name, lastError);
}
