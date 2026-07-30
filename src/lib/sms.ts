// SMS utility for DealFlow AI — Twilio integration
// Server-only: call this only from server functions or API routes.

import { sql } from "~/db";

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendSms(
  to: string,
  message: string,
  leadId?: string,
): Promise<SmsResult> {
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
 * Check if Twilio is configured (env vars present).
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}
