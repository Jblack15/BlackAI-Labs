import { createServerFn } from "@tanstack/react-start";
import { getStartContext } from "@tanstack/start-storage-context";
import { getSessionFromRequest } from "~/auth";
import { sql } from "~/db";

export type SmsResult = { success: true; sid?: string } | { success: false; error: string };

/** Send an SMS through Twilio and record the attempt for the signed-in shop. */
export const sendSms = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("SMS details are required");
    const { recipient, message } = data as { recipient?: unknown; message?: unknown };
    if (typeof recipient !== "string" || !recipient.trim()) throw new Error("A recipient phone number is required");
    if (typeof message !== "string" || !message.trim()) throw new Error("A message is required");
    if (message.length > 1600) throw new Error("SMS messages must be 1,600 characters or less");
    return { recipient: recipient.trim(), message: message.trim() };
  })
  .handler(async ({ data }): Promise<SmsResult> => {
    let userId: number | null = null;
    try {
      const request = getStartContext()?.request;
      const session = request ? getSessionFromRequest(request) : null;
      userId = session?.userId ?? null;
    } catch { /* unauthenticated requests are still logged with no user */ }

    // Twilio accepts E.164 numbers. Reject malformed values before making a paid request.
    if (!/^\+[1-9]\d{7,14}$/.test(data.recipient)) {
      return { success: false, error: "Enter a valid phone number including country code (for example, +15551234567)." };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    let status = "failed";
    try {
      if (!accountSid || !authToken || !from) {
        return { success: false, error: "SMS is not configured yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER." };
      }
      if (!/^\+[1-9]\d{7,14}$/.test(from)) return { success: false, error: "The shop SMS number is not configured correctly." };

      const body = new URLSearchParams({ To: data.recipient, From: from, Body: data.message });
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) {
        let providerMessage = "The SMS provider could not send this message.";
        try { providerMessage = (await response.json()).message || providerMessage; } catch { /* fallback */ }
        return { success: false, error: providerMessage };
      }
      const payload = await response.json() as { sid?: string };
      status = "sent";
      return { success: true, sid: payload.sid };
    } catch (error) {
      console.error("SMS provider error:", error);
      return { success: false, error: "We couldn't send that text right now. Please try again." };
    } finally {
      try {
        await sql`INSERT INTO sms_logs (user_id, recipient, message, status) VALUES (${userId}, ${data.recipient}, ${data.message}, ${status})`;
      } catch (error) { console.error("Failed to save SMS log:", error); }
    }
  });
