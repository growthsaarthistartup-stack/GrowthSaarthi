/**
 * POST /api/webhooks/stripe
 *
 * Handles the four critical Stripe events (spec §3.5):
 *   invoice.payment_failed         → HIGH severity → write StripeEvent + Metric
 *   customer.subscription.deleted  → HIGH severity
 *   customer.subscription.created  → INFO severity
 *   charge.refunded                → INFO severity
 *
 * Idempotency: Stripe event ID is used as the PK directly — already globally unique.
 * The route always returns 200 so Stripe does not retry. Processing errors write
 * AgentFailure facts but never surface as 4xx/5xx to Stripe.
 *
 * To enable: set STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY in .env.local.
 * The startup is identified by the customer's metadata.startupId field.
 */

import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { stripeEvents, startups, alerts } from "@/lib/db/schema";
import { writeAgentFailure } from "@/lib/db/repository";
import { generateULID } from "@/lib/ulid";
import { buildIdempotencyKey, todayWindow } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// Critical events (spec §3.5)
// ---------------------------------------------------------------------------

const CRITICAL_STRIPE_EVENTS = new Set([
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "customer.subscription.created",
  "charge.refunded",
]);

type StripeSeverity = "HIGH" | "INFO";

function getSeverity(eventType: string): StripeSeverity {
  return eventType.includes("deleted") || eventType.includes("failed") ? "HIGH" : "INFO";
}

// ---------------------------------------------------------------------------
// Stripe client — lazy initialisation
// ---------------------------------------------------------------------------

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
}

// ---------------------------------------------------------------------------
// Startup lookup via Stripe customer metadata
// ---------------------------------------------------------------------------

async function resolveStartupId(
  stripe: Stripe,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    const meta = (customer as Stripe.Customer).metadata ?? {};
    if (meta.startupId) return meta.startupId;

    // Fallback: match by email domain against Startup.url
    const email = (customer as Stripe.Customer).email;
    if (email) {
      const domain = email.split("@")[1];
      if (domain) {
        const [startup] = await db
          .select({ id: startups.id })
          .from(startups)
          .where(eq(startups.url, `https://${domain}`))
          .limit(1);
        return startup?.id ?? null;
      }
    }
  } catch { /* non-critical */ }
  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  const body      = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret    = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    const stripe = getStripe();

    if (secret) {
      event = stripe.webhooks.constructEvent(body, signature, secret);
    } else {
      // Dev mode: skip signature verification
      console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — skipping sig verification");
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    // Invalid signature — return 400 so Stripe knows not to retry this exact payload
    console.error("[stripe-webhook] Signature verification failed:", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Filter to critical events only — acknowledge everything else immediately
  if (!CRITICAL_STRIPE_EVENTS.has(event.type)) {
    return Response.json({ received: true });
  }

  // Process — any error is caught, written as AgentFailure, and still returns 200
  try {
    const stripe     = getStripe();
    const obj        = event.data.object as unknown as Record<string, unknown>;
    const customerId = (obj.customer as string | null) ?? null;
    const severity   = getSeverity(event.type);

    const startupId  = await resolveStartupId(stripe, customerId);

    // Idempotency: Stripe event ID is already globally unique → use as PK directly
    await db
      .insert(stripeEvents)
      .values({
        id:         event.id,                           // Stripe event ID as PK
        startupId:  startupId ?? "unknown",
        eventType:  event.type,
        severity,
        customerId: customerId,
        amount:     typeof obj.amount === "number"
          ? obj.amount / 100                            // cents → dollars
          : (typeof obj.amount_paid === "number" ? obj.amount_paid / 100 : null),
        rawJson:    JSON.stringify(event),
      })
      .onConflictDoNothing();                           // Stripe retries → no-op

    if (severity === "HIGH" && startupId) {
      console.error(
        `[stripe-webhook] HIGH severity event ${event.type} for customer ${customerId}` +
          (startupId ? ` (startup: ${startupId})` : " — startup not resolved"),
      );

      // Write real-time alert — bypasses z-score batch job (spec §1d)
      const alertKey = buildIdempotencyKey(
        "StripeAlert", startupId, event.type, todayWindow(),
      );
      const amount = typeof obj.amount === "number"
        ? obj.amount / 100
        : (typeof obj.amount_paid === "number" ? obj.amount_paid / 100 : 0);

      const message = event.type === "invoice.payment_failed"
        ? `Payment failed: $${amount.toFixed(2)} invoice for customer ${customerId ?? "unknown"}`
        : event.type === "customer.subscription.deleted"
        ? `Subscription cancelled for customer ${customerId ?? "unknown"}. MRR impact: $${amount.toFixed(2)}/mo`
        : `Stripe HIGH severity event: ${event.type}`;

      await db
        .insert(alerts)
        .values({
          id:             generateULID(),
          startupId,
          idempotencyKey: alertKey,
          metricType:     "revenue",
          zScore:         -3.5,          // synthetic z-score — real-time event, not batch-computed
          severity:       "critical",
          channel:        "both",
          message,
          source:         "stripe_realtime",
        })
        .onConflictDoNothing();           // idempotent — Stripe may retry
    } else if (severity === "HIGH") {
      console.error(
        `[stripe-webhook] HIGH severity event ${event.type} — startup not resolved for customer ${customerId}`,
      );
    }
  } catch (err) {
    // Write failure fact if we have any startup context, otherwise just log
    console.error("[stripe-webhook] Processing error:", err);
    try {
      await writeAgentFailure("unknown", "stripe_webhook", err, { eventId: event.id, eventType: event.type });
    } catch { /* swallow — never let this 500 */ }
  }

  // Always 200 — Stripe must not retry on processing errors
  return Response.json({ received: true });
}
