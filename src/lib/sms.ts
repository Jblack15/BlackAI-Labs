// DealForge Properties — SMS send path (Telnyx provider wiring, PREP only)
// Server-only: call this only from server functions or API routes.
//
// OWNER-DIRECTED (2026-08-22): the owner approved spend on a compliant SMS
// provider and chose TELNYX, replacing the previously-gated Twilio integration.
//
// FAIL-CLOSED — SMS may ONLY transmit when ALL of the following hold:
//   1. the recipient passes assertOutreachAllowed("sms") — has a phone and is
//      NOT DNC / opted-out / invalid_contact / wrong_number. Reuses the
//      existing compliance core (lib/skip-trace.ts) — no parallel path.
//   2. SMS_ENABLED === "true" (explicit channel opt-in; default OFF).
//   3. all three Telnyx credentials are present (TELNYX_API_KEY /
//      TELNYX_PHONE_NUMBER / TELNYX_MESSAGING_PROFILE_ID) — otherwise
//      "NOT CONNECTED / REQUIRES CREDENTIALS".
//   4. the send is owner-approved: a campaignId referencing an owner-APPROVED
//      channel_campaign approval (kind='channel_campaign', status='approved')
//      exists in /approvals. There is no campaign-less auto-send.
// If any gate fails, the reason is logged and NO SMS is sent.
//
// The SAME four conditions are enforced by the fail-closed channel matrix in
// lib/channel-gates.ts (provider -> campaign -> compliance) for campaign sends.
//
// VOICE (programmatic calling) is OUT OF SCOPE — SMS only.

import { sql } from "~/db";
import { assertLeadOutreachAllowedById } from "~/lib/skip-trace";
import { logOutreachAudit } from "~/lib/compliance";
import { hasApproval } from "~/lib/approvals";
import { readTelnyxEnv, sendTelnyxMessage } from "~/lib/telnyx";

export interface SmsResult {
  success: boolean;
  /** On success: the Telnyx message id (historical field name kept for API
   *  compatibility — it is NOT a Twilio SID anymore). */
  sid?: string;
  error?: string;
}

export interface SmsSendOptions {
  /** REQUIRED for a send (fail closed without it): the id of a campaign that
   *  has an owner-APPROVED channel_campaign approval (/approvals). */
  campaignId?: string | null;
}

/** Explicit opt-in for the SMS channel. Default OFF. Set SMS_ENABLED=true only
 *  after the owner approves the Telnyx provider + A2P 10DLC campaign. */
export const SMS_ENABLED = process.env.SMS_ENABLED === "true";

/** Honest SMS channel state for UI / reporting:
 *   - "NOT CONNECTED" — Telnyx credentials missing (nothing to send with),
 *   - "CONNECTED"     — all three Telnyx creds present AND SMS_ENABLED=true,
 *   - "DISABLED"      — creds present but SMS_ENABLED is off (default).
 */
export type SmsChannelState = "CONNECTED" | "NOT CONNECTED" | "DISABLED";
export function smsChannelState(): SmsChannelState {
  const cfg = readTelnyxEnv();
  if (!cfg.configured) return "NOT CONNECTED";
  return SMS_ENABLED ? "CONNECTED" : "DISABLED";
}

/** Convenience boolean — the "CONNECTED" state (enabled + creds). */
export function isTelnyxConfigured(): boolean {
  return smsChannelState() === "CONNECTED";
}

/** Audit an outbound sms block/failure (never throws). */
async function auditBlocked(leadId: string | undefined, to: string, message: string, reason: string): Promise<void> {
  try {
    await logOutreachAudit({
      leadId: leadId || null,
      channel: "sms",
      direction: "outbound",
      status: "blocked",
      reason,
      contactValue: to,
      contentPreview: message,
    });
  } catch {
    // ignore — audit logging must never break the caller
  }
}

/** Write an sms_logs 'failed' row (never throws). */
async function logSmsFailure(leadId: string | undefined, to: string, message: string): Promise<void> {
  try {
    await sql`
      INSERT INTO sms_logs (lead_id, to_phone, message, status)
      VALUES (${leadId || null}, ${to}, ${message}, 'failed')
    `;
  } catch {
    // silently ignore logging errors
  }
}

export async function sendSms(
  to: string,
  message: string,
  leadId?: string,
  opts?: SmsSendOptions,
): Promise<SmsResult> {
  // ── Gate 1 (compliance) — recipient must pass the existing sms matrix.
  if (leadId) {
    const check = await assertLeadOutreachAllowedById(leadId, "sms");
    if (!check.allowed) {
      await auditBlocked(leadId, to, message, check.reason ?? "Blocked: could not verify contact/compliance clearance");
      await logSmsFailure(leadId, to, message);
      return { success: false, error: check.reason ?? "Blocked: could not verify contact/compliance clearance" };
    }
  }

  // ── Gate 2 (channel opt-in) — SMS_ENABLED must be true (default OFF).
  if (!SMS_ENABLED) {
    console.warn(
      "[sms] Channel disabled — SMS_ENABLED is unset (default OFF). SMS is NOT sent. " +
        "Set SMS_ENABLED=true only after the owner approves the Telnyx provider + A2P 10DLC campaign.",
    );
    await logSmsFailure(leadId, to, message);
    return {
      success: false,
      error: "SMS not available — channel disabled (SMS_ENABLED unset; default OFF). Set SMS_ENABLED=true only after owner approval of the Telnyx provider + A2P 10DLC.",
    };
  }

  // ── Gate 3 (provider credentials) — all three Telnyx vars must be present.
  const telnyxCfg = readTelnyxEnv();
  if (!telnyxCfg.configured) {
    const missing = telnyxCfg.missing.join(", ");
    const reason = `Telnyx not connected — missing ${missing} (REQUIRES CREDENTIALS). No SMS sent.`;
    await auditBlocked(leadId, to, message, reason);
    await logSmsFailure(leadId, to, message);
    return { success: false, error: reason };
  }

  // ── Gate 4 (owner approval) — an owner-APPROVED channel_campaign must exist.
  const campaignId = (opts?.campaignId ?? "").trim();
  if (!campaignId) {
    const reason =
      "SMS send not owner-approved — no campaignId supplied; every send must reference an owner-approved " +
      "channel_campaign approval (approve in /approvals, kind='channel_campaign'). Fail closed: no SMS sent.";
    await auditBlocked(leadId, to, message, reason);
    await logSmsFailure(leadId, to, message);
    return { success: false, error: reason };
  }
  const approved = await hasApproval("channel_campaign", "campaign", campaignId, ["approved"]);
  if (!approved) {
    const reason =
      `SMS send not owner-approved — campaign ${campaignId} has no approved channel_campaign approval ` +
      "(approve in /approvals, kind='channel_campaign'). Fail closed: no SMS sent.";
    await auditBlocked(leadId, to, message, reason);
    await logSmsFailure(leadId, to, message);
    return { success: false, error: reason };
  }

  try {
    const result = await sendTelnyxMessage({
      to,
      text: message,
      from: telnyxCfg.fromNumber,
      messagingProfileId: telnyxCfg.messagingProfileId,
    });
    if (!result.success) {
      await logOutreachAudit({
        leadId: leadId || null,
        channel: "sms",
        direction: "outbound",
        status: "failed",
        reason: result.error,
        contactValue: to,
        contentPreview: message,
      });
      await logSmsFailure(leadId, to, message);
      return { success: false, error: result.error };
    }

    // Outreach status spine (PH1-B6): a real transmission advances pre-contact
    // leads to contact_attempted (new/contactable/outreach_queued/follow_up).
    // Inert while the channel is disabled — the wiring must exist so the state
    // machine advances the moment SMS is re-enabled by the owner.
    if (leadId) {
      try {
        const { noteOutreachAttempt } = await import("~/lib/outreach-status");
        await noteOutreachAttempt(leadId, "sms", "sent");
      } catch {
        // never let the status bump break a send
      }
    }

    await sql`
      INSERT INTO sms_logs (lead_id, to_phone, message, status, twilio_sid, provider_id)
      VALUES (${leadId || null}, ${to}, ${message}, 'sent', ${result.messageId}, ${result.messageId})
    `;

    return { success: true, sid: result.messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await logOutreachAudit({
      leadId: leadId || null,
      channel: "sms",
      direction: "outbound",
      status: "failed",
      reason: errorMsg,
      contactValue: to,
      contentPreview: message,
    });
    await logSmsFailure(leadId, to, message);
    return { success: false, error: errorMsg };
  }
}
