// DealForge Properties — Telnyx INBOUND SMS webhook handling (PREP only)
// ─────────────────────────────────────────────────────────────────────────────
// Receives Telnyx inbound-message webhooks (event_type = "message.received"),
// records the message, audits it to the compliance core, and applies the
// existing opt-out mechanism: STOP / UNSUBSCRIBE / CANCEL / END / QUIT →
// handleOptOut() (lib/compliance.ts) marks the lead opted_out + writes the
// consent record + audit row. No parallel compliance path is invented.
//
// Webhook signature verification (Telnyx-Signature HMAC) is a TODO — see the
// API route (src/routes/api/sms/inbound.ts), which keeps the endpoint behind a
// shared-secret token (TELNYX_WEBHOOK_SECRET via ?token=) until real signature
// verification lands.
//
// This module inserts into `sms_inbound_log` (migration 028). If the table is
// missing (migration not applied), it still audits the event and processes the
// opt-out — it never crashes a webhook caller.
// ─────────────────────────────────────────────────────────────────────────────
import { sql } from "~/db";
import { logOutreachAudit, handleOptOut } from "~/lib/compliance";

/** Telnyx v2 webhook envelope (defensively typed — the real payload is much
 *  larger; only the fields we use are declared). */
export type TelnyxWebhookEnvelope = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: {
      id?: string;
      direction?: string;
      from?: { phone_number?: string; carrier?: string } | string;
      to?: Array<{ phone_number?: string; status?: string } | string>;
      text?: string;
      messaging_profile_id?: { id?: string; record_type?: string } | string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export type ParsedTelnyxInbound = {
  eventType: string;
  messageId: string | null;
  from: string | null;
  to: string | null;
  text: string;
  profileId: string | null;
};

/**
 * Extract the message + sender/recipient from a Telnyx inbound webhook body.
 * Returns null when the event is not an inbound message (ignored harmlessly).
 */
export function parseTelnyxInbound(body: unknown): ParsedTelnyxInbound | null {
  const data = (body as TelnyxWebhookEnvelope)?.data;
  if (!data || data.event_type !== "message.received") return null;
  const payload = data.payload ?? {};
  const fromRaw = payload.from;
  const from =
    typeof fromRaw === "string"
      ? fromRaw
      : typeof fromRaw?.phone_number === "string"
        ? fromRaw.phone_number
        : null;
  const toArr = Array.isArray(payload.to) ? payload.to : [];
  const firstTo =
    (toArr[0] && typeof toArr[0] === "string" ? toArr[0] : toArr[0]?.phone_number) ?? null;
  const to = typeof payload.to === "string" ? payload.to : firstTo;
  const profileRaw = payload.messaging_profile_id;
  const profileId =
    typeof profileRaw === "string"
      ? profileRaw
      : typeof profileRaw?.id === "string"
        ? profileRaw.id
        : null;
  return {
    eventType: data.event_type,
    messageId: payload.id ?? data.id ?? null,
    from,
    to,
    text: typeof payload.text === "string" ? payload.text : "",
    profileId,
  };
}

/** TCPA opt-out words (Telnyx/10DLC also auto-processes STOP at the carrier,
 *  this is the app-side enforcement so suppression is instant + audit-trailed).
 *  Covers STOP, STOPALL, UNSUBSCRIBE, OPT OUT, CANCEL, END, QUIT. */
const OPT_OUT_RE = /\b(stop\s?all|stop|unsubscribe|opt\s?out|cancel|end|quit)\b/i;

export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_RE.test(text);
}

export type TelnyxInboundResult = {
  /** True when the body was a recognized message.received event. */
  received: boolean;
  /** True when the message body was an opt-out and handleOptOut succeeded. */
  optOutHandled: boolean;
  leadId?: string;
  /** True when the event was stored to sms_inbound_log. */
  stored: boolean;
  reason?: string;
};

/**
 * Handle one Telnyx inbound webhook body. Idempotent in effect (an opt-out sets
 * opted_out=true — re-delivery of the same webhook simply re-records).
 */
export async function handleTelnyxInbound(body: unknown): Promise<TelnyxInboundResult> {
  const evt = parseTelnyxInbound(body);
  if (!evt) {
    return { received: false, optOutHandled: false, stored: false, reason: "Not a Telnyx message.received event (ignored)" };
  }
  const from = evt.from ?? "";
  const text = evt.text;

  // 1. Store the inbound message (best-effort — never breaks the caller).
  let stored = false;
  let storeError: string | null = null;
  try {
    await sql`
      INSERT INTO sms_inbound_log (from_phone, to_phone, message, message_id, profile_id)
      VALUES (${from || null}, ${evt.to}, ${text}, ${evt.messageId}, ${evt.profileId})
    `;
    stored = true;
  } catch (err) {
    storeError = err instanceof Error ? err.message : "sms_inbound_log write failed";
  }

  // 2. Audit the inbound event (compliance-core trail; never throws).
  await logOutreachAudit({
    leadId: null,
    channel: "sms",
    direction: "inbound",
    status: "received",
    reason: storeError ? `Inbound SMS received — store failed (${storeError})` : undefined,
    contactValue: from || null,
    contentPreview: text,
    operator: "telnyx-webhook",
  });

  // 3. Opt-out handling through the EXISTING mechanism (handleOptOut resolves
  //    the lead by phone and flips opted_out + consent record + audit).
  if (isOptOutMessage(text)) {
    const result = await handleOptOut(from, "sms", {
      source: "telnyx-inbound",
      detail: text,
      operator: "telnyx-webhook",
    });
    // Reflect the opt-out on the stored row (best-effort).
    if (stored && from) {
      try {
        await sql`
          UPDATE sms_inbound_log SET handled_optout = true
          WHERE id = (
            SELECT id FROM sms_inbound_log
            WHERE from_phone = ${from} AND message = ${text}
            ORDER BY received_at DESC LIMIT 1
          )
        `;
      } catch {
        // best-effort only
      }
    }
    return {
      received: true,
      optOutHandled: result.success,
      leadId: result.leadId,
      stored,
      reason: result.success ? undefined : result.error ?? undefined,
    };
  }
  return { received: true, optOutHandled: false, stored };
}