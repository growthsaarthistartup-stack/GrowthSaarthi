/**
 * SEO Ingestion Agent
 *
 * Data source: Google Search Console API (free, OAuth).
 * Gate: runs only if an active GSC Integration row exists for this startup.
 * If no integration → skip gracefully (write one AgentFailure-style note, return null).
 * No paid SEO APIs anywhere in this file.
 *
 * Writes: Keyword facts (type "owned" for ranked terms, "gap" for competitor-only terms).
 */

import { eq, and } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/lib/db/client";
import { integrations, keywords } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { buildIdempotencyKey, isoWeekWindow } from "@/lib/idempotency";
import { generateULID } from "@/lib/ulid";

// ---------------------------------------------------------------------------
// GSC OAuth2 client from stored Integration credentials
// ---------------------------------------------------------------------------

interface GscIntegration {
  accessToken:  string | null;
  refreshToken: string | null;
}

function buildGscClient(integration: GscIntegration) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({
    access_token:  integration.accessToken,
    refresh_token: integration.refreshToken,
  });
  return auth;
}

// ---------------------------------------------------------------------------
// GSC query — last 28 days, by query+page dimension
// ---------------------------------------------------------------------------

interface GscRow {
  keys:    string[];
  clicks:  number;
  impressions: number;
  ctr:     number;
  position: number;
}

async function querySearchConsole(
  auth: ReturnType<typeof buildGscClient>,
  domain: string,
): Promise<GscRow[]> {
  const webmasters = google.webmasters({ version: "v3", auth });
  const siteUrl    = domain.startsWith("http") ? domain : `https://${domain}`;

  const res = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate:  nDaysAgo(28),
      endDate:    nDaysAgo(0),
      dimensions: ["query", "page"],
      rowLimit:   100,
    },
  });

  return (res.data.rows ?? []) as GscRow[];
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type KeywordRow = typeof keywords.$inferSelect;

export async function runSeoIngestion(
  startupId: string,
  domain: string,
): Promise<KeywordRow[] | null> {
  try {
    // Check for an active GSC integration
    const [integration] = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.startupId, startupId),
          eq(integrations.type, "gsc"),
          eq(integrations.connected, true),
        ),
      )
      .limit(1);

    if (!integration) {
      // Graceful skip — not a hard error, just not connected yet
      console.info(
        `[seo-agent] No active GSC integration for ${startupId} — skipping SEO ingestion.`,
      );
      return null;
    }

    const weekKey = buildIdempotencyKey("SeoScan", startupId, "gsc", isoWeekWindow());

    // Check if we already ran this week (first keyword for this week = done)
    const [existing] = await db
      .select({ id: keywords.id })
      .from(keywords)
      .where(eq(keywords.idempotencyKey, weekKey + ":0"))
      .limit(1);
    if (existing) {
      return db.select().from(keywords).where(eq(keywords.startupId, startupId));
    }

    // Build GSC client and fetch data
    const auth    = buildGscClient(integration);
    const rows    = await querySearchConsole(auth, domain);
    const written: KeywordRow[] = [];

    for (const [idx, row] of rows.entries()) {
      const term    = row.keys[0] ?? "";
      const ranking = Math.round(row.position);
      if (!term) continue;

      const iKey = weekKey + ":" + idx;
      const [kw] = await db
        .insert(keywords)
        .values({
          id:             generateULID(),
          startupId,
          idempotencyKey: iKey,
          term,
          searchVolume:   row.impressions,   // impressions ≈ search exposure
          startupRanking: ranking,
          type:           ranking <= 10 ? "owned" : "gap",
        })
        .onConflictDoNothing()
        .returning();

      if (kw) written.push(kw);
    }

    return written;
  } catch (err) {
    await writeAgentFailure(startupId, "seo_agent", err, { domain });
    return null;
  }
}
