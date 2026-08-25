// DealForge Properties — Telnyx SMS client (SMS provider wiring, PREP only)
// ─────────────────────────────────────────────────────────────────────────────
// Minimal, typed wrapper around the Telnyx v2 REST API (POST /v2/messages).
// This is the SMS provider that replaces the previously-gated Twilio wiring.
//
// HONESTY RULES:
//   * Credentials are read from env (business secrets) — NEVER hardcoded.
//       - TELNYX_API_KEY                 — Telnyx v2 API key (Bearer auth)
//       - TELNYX_PHONE_NUMBER            — sender number, E.164 (e.g. +1212…)
//       - TELNYX_MESSAGING_PROFILE_ID    — required for A2P 10DLC sends
//   * When ANY required credential is missing, the app reports
//     "NOT CONNECTED / REQUIRES CREDENTIALS" — it never throws and never fakes.
//   * This module performs the NETWORK CALL ONLY. It does NOT decide whether a
//     send is allowed — compliance / SMS_ENABLED / owner-approval gating lives
//     in src/lib/sms.ts (the send path) and src/lib/channel-gates.ts (the
//     fail-closed channel matrix). Call sendTelnyxMessage() directly only from
//     a path that has already passed the gates.
//
// Server-only: call this only from server functions / API routes / scripts.
//
// Out-of-scope: VOICE (programmatic calling) is NOT covered here — SMS only.
// ─────────────────────────────────────────────────────────────────────────────

/** Telnyx v2 REST API base URL. */
export const TELNYX_API_BASE = "https://api.telnyx.com/v2";
export const TELNYX_MESSAGES_PATH = "/messages";

/** The env vars that must all be present for the SMS channel to be CONNECTED. */
export const TELNYX_REQUIRED_ENVS = [
  "TELNYX_API_KEY",
  "TELNYX_PHONE_NUMBER",
  "TELNYX_MESSAGING_PROFILE_ID",
] as const;

export type TelnyxConfig = {
  apiKey: string;
  fromNumber: string;
  messagingProfileId: string;
};

/** Pure env read. Returns which required vars are missing (empty => configured).
 *  Never throws; safe to call anywhere, including at module scope of a route. */
export function readTelnyxEnv(): { configured: boolean; missing: string[]; config: TelnyxConfig | null } {
  const apiKey = (process.env.TELNYX_API_KEY || "").trim();
  const fromNumber = (process.env.TELNYX_PHONE_NUMBER || "").trim();
  const messagingProfileId = (process.env.TELNYX_MESSAGING_PROFILE_ID || "").trim();
  const missing: string[] = [];
  if (!apiKey) missing.push("TELNYX_API_KEY");
  if (!fromNumber) missing.push("TELNYX_PHONE_NUMBER");
  if (!messagingProfileId) missing.push("TELNYX_MESSAGING_PROFILE_ID");
  if (missing.length) return { configured: false, missing, config: null };
  return { configured: true, missing: [], config: { apiKey, fromNumber, messagingProfileId } };
}

/** Convenience boolean — true only when all three Telnyx creds are present. */
export function isTelnyxConfigured(): boolean {
  return readTelnyxEnv().configured;
}

// --- Message send ------------------------------------------------------------

export type TelnyxSendMessageInput = {
  /** Recipient number, E.164 (e.g. +12125550123). */
  to: string;
  /** Message body. */
  text: string;
  /** Sender number, E.164. Defaults to TELNYX_PHONE_NUMBER when omitted. */
  from?: string;
  /** Messaging profile id (required for A2P 10DLC). Defaults to the env
   *  TELNYX_MESSAGING_PROFILE_ID when omitted. */
  messagingProfileId?: string;
  /** Message type — SMS by default. */
  type?: "SMS" | "MMS";
};

export type TelnyxSendResult =
  | { success: true; messageId: string }
  | { success: false; error: string; status?: number };

const TELNYX_TIMEOUT_MS = 15_000;

/**
 * POST a message to the Telnyx v2 API. NO compliance/approval gating lives here
 * — callers must have already passed the fail-closed gates (sms.ts / channel
 * gates). A `fetchImpl` may be injected for dry-run/unit tests (never hits the
 * network). Returns the Telnyx message `data.id` on success.
 */
export async function sendTelnyxMessage(
  input: TelnyxSendMessageInput,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<TelnyxSendResult> {
  const env = readTelnyxEnv();
  const apiKey = env.config?.apiKey ?? "";
  const from = input.from ?? env.config?.fromNumber ?? "";
  const messagingProfileId = input.messagingProfileId ?? env.config?.messagingProfileId ?? "";
  const to = (input.to || "").trim();
  const text = (input.text || "").trim();

  if (!apiKey) return { success: false, error: "Telnyx not connected — TELNYX_API_KEY missing (REQUIRES CREDENTIALS)" };
  if (!from) return { success: false, error: "Telnyx not connected — TELNYX_PHONE_NUMBER missing (REQUIRES CREDENTIALS)" };
  if (!messagingProfileId) {
    return { success: false, error: "Telnyx not connected — TELNYX_MESSAGING_PROFILE_ID missing (REQUIRED for A2P 10DLC)" };
  }
  if (!to) return { success: false, error: "Telnyx send refused: no recipient (to) supplied" };
  if (!text) return { success: false, error: "Telnyx send refused: empty message body" };

  const url = `${TELNYX_API_BASE}${TELNYX_MESSAGES_PATH}`;
  const body = JSON.stringify({
    from,
    to,
    text,
    messaging_profile_id: messagingProfileId,
    type: input.type ?? "SMS",
  });

  let signal: AbortSignal | undefined;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    try {
      signal = AbortSignal.timeout(TELNYX_TIMEOUT_MS);
    } catch {
      signal = undefined;
    }
  }

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal,
    });
    const raw = (await resp.json().catch(() => null)) as
      | { data?: { id?: string }; errors?: Array<{ detail?: string }> }
      | null;
    if (!resp.ok) {
      const detail = raw?.errors?.[0]?.detail ?? `Telnyx API error (HTTP ${resp.status})`;
      return { success: false, error: detail, status: resp.status };
    }
    const messageId = raw?.data?.id ?? "unknown";
    return { success: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown Telnyx send error";
    return { success: false, error: msg };
  }
}
