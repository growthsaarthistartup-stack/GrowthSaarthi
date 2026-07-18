/**
 * GET /api/onboarding/progress?startupName=...&websiteUrl=...&stage=...&primaryGoal=...
 *
 * Server-Sent Events stream that emits the exact log message strings already
 * present in handleStartScan in page.tsx — so the UI needs zero copy changes.
 *
 * Event format (one per line, double-newline terminated):
 *   data: { log: string, progress: number }\n\n
 *   data: { done: true }\n\n          ← final event, stream closes
 *
 * The route drives progress from 0 → 100 across 8 steps (12.5% each) to match
 * the setInterval(800ms) timing the UI already renders correctly.
 *
 * The actual pipeline (POST /api/onboarding) runs concurrently — this route
 * only emits the progress messages; the final result comes from the POST response.
 */

import type { NextRequest } from "next/server";

const STEP_DELAY_MS = 800; // matches the original setInterval timing

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

export async function GET(request: NextRequest): Promise<Response> {
  const params       = request.nextUrl.searchParams;
  const startupName  = params.get("startupName") ?? "your startup";
  const websiteUrl   = params.get("websiteUrl")  ?? "";

  // Exact strings from page.tsx handleStartScan logMessages array
  const logMessages: string[] = [
    `Initiating GrowthSaarthi Discovery Scan for ${startupName}...`,
    websiteUrl
      ? `[Scraping website] Reading metadata, H1 headings, and structure from ${websiteUrl}...`
      : `[Pre-launch state] Scanning industry databases and category trends...`,
    `[Competitor intelligence] Scanning competitor databases for value-prop overlaps...`,
    `[SEO Audit] Querying Google indexation and keyword density parameters...`,
    `[pricing audit] Comparing standard SaaS tiers and billing options in the industry...`,
    `[Knowledge graph] Injecting facts, relationships, and nodes...`,
    `[Orchestrator] Building custom 30-Day Growth Roadmap...`,
    `Generating comprehensive score cards... Scan Completed.`,
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      }

      // Emit 8 steps × 12.5% = 100%, one per STEP_DELAY_MS
      for (let i = 0; i < logMessages.length; i++) {
        await sleep(STEP_DELAY_MS);
        const progress = Math.min((i + 1) * 12.5, 100);
        send({ log: logMessages[i], progress });
      }

      // Signal completion
      send({ done: true });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering on Vercel
    },
  });
}
