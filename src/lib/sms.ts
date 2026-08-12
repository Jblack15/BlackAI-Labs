// SMS utility for DealForge Properties — Twilio integration (DISABLED).
// Server-only: call this only from server functions or API routes.
//
// The owner dropped Twilio on 2026-08-12 (outreach is voice via BatchDialer +
// direct mail/email via PropStream Campaigns; PropStream has NO SMS product).
// Sends are INERT by default: they require the explicit enable flag below
// (SMS_ENABLED=true), which must only be set after an owner decision to
// revisit SMS with a TCPA-compliant provider. Nothing may fire otherwise.

import { sql } from "~/db";

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

/**
 * Explicit opt-in for the SMS channel. Default OFF. Set SMS_ENABLED=true only
 * after an owner decision to re-enable SMS with a TCPA-compliant provider.
 */
export const SMS_ENABLED = process.env.SMS_ENABLED === "true";

export async function sendSms(
  to: string,
  message: string,
  leadId?: string,
): Promise<SmsResult> {
  // Hard block (PH1-B1): nothing sends to a lead without contact info or with
  // a suppression flag. Full compliance suppression table lands in B2; the
  // missing-contact block is this build. Form-submitted leads (seller opted in
  // by submitting) don't pass a leadId yet — the block applies to CRM/drip
  // sends that address a known lead.
  if (leadId) {
    try {
      const { assertLeadOutreachAllowedById } = await import("~/lib/skip-trace");
      const check = await assertLeadOutreachAllowedById(leadId);
      if (!check.allowed) {
        try {
          await sql`
            INSERT INTO sms_logs (lead_id, to_phone, message, status)
            VALUES (${leadId}, ${to}, ${message}, 'failed')
          `;
        } catch {
          // silently ignore logging errors
        }
        return { success: false, error: check.reason };
      }
    } catch {
      // If the compliance check itself fails, do not send — fail closed.
      return { success: false, error: "Blocked: could not verify contact/compliance clearance for lead" };
    }
  }
  if (!SMS_ENABLED) {
    console.warn(
      "[sms] Channel disabled: Twilio was dropped by the owner 2026-08-12. " +
        "SMS is NOT sent. Set SMS_ENABLED=true only after an owner decision " +
        "to revisit SMS with a TCPA-compliant provider.",
    );
    try {
      await sql`
        INSERT INTO sms_logs (lead_id, to_phone, message, status)
        VALUES (${leadId || null}, ${to}, ${message}, 'failed')
      `;
    } catch {
      // silently ignore logging errors
    }
    return {
      success: false,
      error: "SMS not available — channel discontinued 2026-08-12 (owner decision)",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    // Log as failed but don't crash
    try {
      await sql`
        INSERT INTO sms_logs (lead_id, to_phone, message, status)
        VALUES (${leadId || null}, ${to}, ${message}, 'failed')
      `;
    } catch {
      // silently ignore logging errors
    }
    return { success: false, error: "Twilio not configured" };
  }

  try {
    // Dynamic import of twilio — only used server-side
    const twilio = await import("twilio");
    const client = twilio.default(accountSid, authToken);

    const twilioMsg = await client.messages.create({
      body: message,
      to,
      from: fromPhone,
    });

    await sql`
      INSERT INTO sms_logs (lead_id, to_phone, message, status, twilio_sid)
      VALUES (${leadId || null}, ${to}, ${message}, 'sent', ${twilioMsg.sid})
    `;

    return { success: true, sid: twilioMsg.sid };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    try {
      await sql`
        INSERT INTO sms_logs (lead_id, to_phone, message, status)
        VALUES (${leadId || null}, ${to}, ${message}, 'failed')
      `;
    } catch {
      // silently ignore
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * SMS is considered configured only when the channel is explicitly enabled
 * (SMS_ENABLED=true) AND the Twilio env vars are present. Reports false while
 * the channel is discontinued, so no UI can claim SMS is active.
 */
export function isTwilioConfigured(): boolean {
  if (!SMS_ENABLED) return false;
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}
