// DealFlow AI — Telnyx INBOUND SMS webhook endpoint (PREP only)
//
//   POST /api/sms/inbound
//
// Receives Telnyx inbound-message webhooks and routes them through
// src/lib/sms-inbound.ts (records to sms_inbound_log, audits, applies the
// existing opt-out handler for STOP/UNSUBSCRIBE/etc).
//
// AUTH / SIGNATURE:
//   * If TELNYX_WEBHOOK_SECRET is set, the webhook URL must carry
//     ?token=<secret> (same shared-secret pattern as /api/outreach/dispatch).
//   * Telnyx-Signature HMAC header verification is a TODO — implement it before
//     pointing a LIVE Telnyx webhook here. Until real signature verification
//     lands, keep TELNYX_WEBHOOK_SECRET set and the webhook URL unguessable.
//
// Returns quickly ({ ok: true }) so Telnyx does not retry storm; it never
// throws on a malformed body.

import { createFileRoute } from "@tanstack/react-router";
import { handleTelnyxInbound } from "~/lib/sms-inbound";

async function run({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const webhookSecret = process.env.TELNYX_WEBHOOK_SECRET;
  if (webhookSecret && url.searchParams.get("token") !== webhookSecret) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const body = await request.json().catch(() => null);
    const result = await handleTelnyxInbound(body);
    return Response.json({ ok: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown webhook error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/sms/inbound")({
  server: {
    handlers: {
      POST: run,
    },
  },
} as never);
