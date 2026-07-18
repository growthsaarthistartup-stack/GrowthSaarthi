/**
 * GraphRepository helpers.
 *
 * Rules (spec §4):
 *   - Never mutate a fact — always insert.
 *   - Idempotency key prevents duplicate writes on retry.
 *   - writeAgentFailure must never itself throw — it swallows its own errors so
 *     reporting a failure can never kill the pipeline.
 */

import { db } from "./client";
import { agentFailures } from "./schema";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// AgentFailure writer — used by every ingestion agent inside its catch block
// ---------------------------------------------------------------------------

export async function writeAgentFailure(
  startupId: string,
  agentName: string,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(agentFailures).values({
      id:           generateULID(),
      startupId,
      agentName,
      errorMessage: error instanceof Error ? error.message : String(error),
      context:      context ? JSON.stringify(context) : null,
    });
  } catch (dbErr) {
    // Swallow — never let failure reporting itself kill the pipeline
    console.error("[repository] Failed to write AgentFailure:", dbErr);
  }
}
