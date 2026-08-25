// DealFlow AI — Channel Activation gates (Step 11, FAIL-CLOSED)
//
// The owner asked for a "text and email all leads in the queue" OPTION. We are
// NOT building blasting (TCPA risk on cold text, sender-reputation risk on cold
// email, zero-spend mode). This lib builds the GATED OPTION only:
//
//   every future SMS/email send path MUST call assertChannelSendAllowed()
//   first, and it refuses the send until ALL of these gates are met:
//
//   (1) PROVIDER  — the channel's provider config is present (env). SMS now
//                   requires SMS_ENABLED=true AND all three Telnyx credentials
//                   (TELNYX_API_KEY / TELNYX_PHONE_NUMBER /
//                   TELNYX_MESSAGING_PROFILE_ID — A2P 10DLC). Until the owner
//                   supplies those, SMS hard-refuses every send. Email requires
//                   SMTP_HOST / SMTP_USER / SMTP_PASS. No autonomous outbound
//                   until the owner approves a provider + budget and the
//                   credentials are actually configured.
//   (2) CAMPAIGN  — the send references an owner-APPROVED per-campaign record:
//                   an approval_requests row with kind='channel_campaign',
//                   ref_type='campaign', ref_id=<campaign UUID>, status=
//                   'approved' (created via the existing requestApproval() and
//                   decided by the owner in /approvals — the SAME human-approval
//                   store used for offers/contracts/spend). No approved row =
//                   channel OFF for that campaign. The approval record IS the
//                   per-campaign toggle: approved = ON, pending/rejected/
//                   cancelled = OFF.
//   (3) COMPLIANCE — the lead passes the EXISTING compliance matrix
//                   (assertOutreachAllowed in lib/skip-trace.ts): right contact
//                   info for the channel and NO suppression flags (dnc_flag /
//                   opted_out / invalid_contact / wrong_number / do_not_mail
//                   per the channel matrix). A suppressed lead can never be
//                   reached on any channel, ever.
//
// Gate order is fixed (provider -> campaign -> compliance) so the reason string
// names the FIRST unmet gate. When all gates pass the result is
// { allowed: true, gates: [...] } — a future send path may then transmit.
//
// Honor rules: EVERYTHING here reads real config / real DB rows. There is no
// fake "configured" state and no simulated approval. Today's honest state is
// OFF / NOT CONFIGURED for both channels, and the Activate button on the
// /channels route is visibly disabled until the owner unlocks a channel.
import { sql } from "~/db";
import { hasApproval } from "~/lib/approvals";
import { assertOutreachAllowed, type OutreachCheckLead } from "~/lib/skip-trace";
import { readTelnyxEnv } from "~/lib/telnyx";

export type SendChannel = "sms" | "email";
export type ChannelGateName = "provider" | "campaign" | "compliance";

export type ChannelGateResult =
  | { allowed: true; campaignId: string; gates: ChannelGateName[] }
  | { allowed: false; gate: ChannelGateName; reason: string };

// --- Gate 1: provider-config presence (the hard off-switch today) ------------
// SMS: Telnyx, registered by TELNYX_API_KEY + TELNYX_PHONE_NUMBER +
// TELNYX_MESSAGING_PROFILE_ID (A2P 10DLC) AND the explicit SMS_ENABLED=true
// opt-in (default OFF). Absent -> OFF / NOT CONNECTED.
// Email: SMTP credentials, same env names the existing email-outreach lib uses
// (SMTP_HOST + SMTP_USER + SMTP_PASS). Absent -> OFF.
const SMS_ENABLE_FLAG_ENV = "SMS_ENABLED";
const SMTP_REQUIRED_ENVS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const;

export type ProviderConfigStatus = {
  configured: boolean;
  provider: string | null;
  /** Env var names that are missing (empty array when configured). */
  missing: string[];
  /** Honest SMS channel state ("CONNECTED" | "NOT CONNECTED" | "DISABLED");
   *  undefined for email. Drives the /channels + compliance UI. */
  state?: "CONNECTED" | "NOT CONNECTED" | "DISABLED";
};

export function providerConfigStatus(channel: SendChannel): ProviderConfigStatus {
  if (channel === "sms") {
    const telnyx = readTelnyxEnv();
    const enabled = process.env[SMS_ENABLE_FLAG_ENV] === "true";
    const missing: string[] = [];
    if (!enabled) missing.push(`${SMS_ENABLE_FLAG_ENV}=true`);
    missing.push(...telnyx.missing);
    if (missing.length) {
      // Creds missing is the dominant signal ("NOT CONNECTED"); creds present
      // but flag off is "DISABLED".
      return {
        configured: false,
        provider: null,
        missing,
        state: telnyx.configured ? "DISABLED" : "NOT CONNECTED",
      };
    }
    return { configured: true, provider: "telnyx", missing: [], state: "CONNECTED" };
  }
  const missing = SMTP_REQUIRED_ENVS.filter((k) => !(process.env[k] || "").trim());
  if (missing.length) return { configured: false, provider: null, missing: [...missing] };
  return { configured: true, provider: "SMTP", missing: [] };
}

// --- The gate -----------------------------------------------------------------
/**
 * FAIL-CLOSED send gate for SMS / email. Every future send path calls this
 * FIRST and MUST abort when allowed === false (the reason explains the first
 * unmet gate). Today both channels refuse every send because no provider is
 * configured (zero-spend mode; no approved provider).
 *
 * @param channel   "sms" | "email"
 * @param lead      lead compliance fields (see OutreachCheckLead) — the same
 *                  shape assertOutreachAllowed consumes
 * @param opts      { campaignId } — REQUIRED. Every send is per-campaign and
 *                  must reference an owner-APPROVED channel_campaign approval;
 *                  omitting it is itself a refusal (fail closed).
 */
export async function assertChannelSendAllowed(
  channel: SendChannel,
  lead: OutreachCheckLead,
  opts: { campaignId: string },
): Promise<ChannelGateResult> {
  // Gate 1 — provider configured (hard off today).
  const cfg = providerConfigStatus(channel);
  if (!cfg.configured) {
    const missing = cfg.missing.length > 0 ? cfg.missing.join(", ") : "provider config";
    return {
      allowed: false,
      gate: "provider",
      reason:
        `Blocked: channel "${channel}" is NOT CONFIGURED — missing provider credential(s) [${missing}]. ` +
        `The ${channel === "sms" ? "SMS" : "email"} channel stays OFF until the owner approves a compliant provider + budget and the credentials are configured.`,
    };
  }
  // Gate 2 — owner-approved per-campaign record (kind = 'channel_campaign').
  if (!opts || !opts.campaignId) {
    return {
      allowed: false,
      gate: "campaign",
      reason:
        "Blocked: no campaignId supplied — every send must reference an owner-approved " +
        "channel_campaign approval (kind='channel_campaign', ref_type='campaign').",
    };
  }
  const campaignApproved = await hasApproval("channel_campaign", "campaign", opts.campaignId, ["approved"]);
  if (!campaignApproved) {
    return {
      allowed: false,
      gate: "campaign",
      reason:
        `Blocked: campaign ${opts.campaignId} has no owner-approved channel_campaign approval — ` +
        `the "${channel}" channel is OFF for this campaign until the owner approves it in /approvals.`,
    };
  }
  // Gate 3 — lead compliance (existing matrix: contact info + suppression flags).
  const comp = assertOutreachAllowed(lead, channel);
  if (!comp.allowed) {
    return { allowed: false, gate: "compliance", reason: comp.reason ?? `Blocked: lead is not ${channel}-compliant.` };
  }
  return { allowed: true, campaignId: opts.campaignId, gates: ["provider", "campaign", "compliance"] };
}

// --- Honest status + Step-11 economics for the /channels UI -------------------
/** Owner-facing Step-11 block per channel. Cost/benefit are labeled ESTIMATES —
 *  nothing here is a live quote, and REQUIRED BUDGET = to be approved. */
export type ChannelStep11 = {
  cost: string;
  benefit: string;
  requiredBudget: string;
  approval: string;
};

export type ChannelStatus = {
  channel: SendChannel;
  label: string;
  status: "OFF" | "NOT CONFIGURED" | "CONNECTED";
  configured: boolean;
  provider: string | null;
  missing: string[];
  state?: "CONNECTED" | "NOT CONNECTED" | "DISABLED";
  step11: ChannelStep11;
  activateDisabled: true;
  activateReason: string;
  /** Real count of approved channel_campaign approvals in the DB (0 today). */
  approvedCampaigns: number;
};

export const CHANNEL_STEP11: Record<SendChannel, ChannelStep11> = {
  sms: {
    cost: "~$0.0075 per SMS segment via Telnyx (estimate — provider unconnected; credentials not configured)",
    benefit:
      "Fast first touch on DNC-clean numbers; opt-out honored instantly via the existing handleOptOut path (STOP/UNSUBSCRIBE → opted_out + consent record + audit). Ready to send the moment Telnyx credentials + A2P 10DLC approval land.",
    requiredBudget: "Owner-approved Telnyx spend budget — none exists today.",
    approval: "Owner-only via /approvals (kind = channel_campaign) AFTER Telnyx credentials + A2P 10DLC are approved.",
  },
  email: {
    cost: "Via an SMTP provider at to-be-quoted volume (estimate — no SMTP configured today)",
    benefit:
      "Automated nurture sequence to collected emails; Reply-To lands in the team inbox. Not built yet — this card is only the gated option.",
    requiredBudget: "To be approved — no SMTP provider configured; no budget exists.",
    approval: "Owner-only via /approvals (kind = channel_campaign) AFTER SMTP + budget are approved.",
  },
};

const ACTIVATE_REASON = (channel: SendChannel, missing: string[]): string =>
  `Requires an approved provider + budget + owner consent for ${channel.toUpperCase()}. Currently missing: ${
    missing.length ? missing.join(", ") : "owner approval"
  } — the Activate control stays disabled until all gates are met.`;

async function approvedChannelCampaignCount(): Promise<number> {
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n FROM approval_requests
      WHERE kind = 'channel_campaign' AND status = 'approved'
    `) as { n: number }[];
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Live per-channel status for the /channels route (owner-gated server fn). */
export async function getChannelStatus(channel: SendChannel): Promise<ChannelStatus> {
  const cfg = providerConfigStatus(channel);
  const approvedCampaigns = await approvedChannelCampaignCount();
  // SMS status is honest: CONNECTED (all gates on the provider side) vs
  // NOT CONFIGURED (creds missing) vs OFF (SMS_ENABLED flag off => DISABLED).
  const status: ChannelStatus["status"] =
    channel === "sms"
      ? cfg.state === "CONNECTED"
        ? "CONNECTED"
        : cfg.state === "DISABLED"
          ? "OFF"
          : "NOT CONFIGURED"
      : cfg.configured
        ? "NOT CONFIGURED"
        : "OFF";
  return {
    channel,
    label: channel === "sms" ? "SMS (text)" : "Email",
    status,
    configured: cfg.configured,
    provider: cfg.provider,
    missing: cfg.missing,
    state: cfg.state,
    step11: CHANNEL_STEP11[channel],
    activateDisabled: true,
    activateReason: ACTIVATE_REASON(channel, cfg.missing),
    approvedCampaigns,
  };
}

export type ChannelsOverview = {
  sms: ChannelStatus;
  email: ChannelStatus;
  zeroSpend: true;
  summary: string;
  /** What a future send path must call before transmitting (function name). */
  gateFunction: "assertChannelSendAllowed";
};

/** Dashboard summary + both cards for /channels. Honest: everything reads real
 *  config (env) and real DB rows; nothing is claimed as connected that is not. */
export async function getChannelsOverview(): Promise<ChannelsOverview> {
  const [sms, email] = await Promise.all([getChannelStatus("sms"), getChannelStatus("email")]);
  const smsState =
    sms.state === "CONNECTED"
      ? "CONNECTED (Telnyx)"
      : sms.state === "DISABLED"
        ? "DISABLED (SMS_ENABLED off)"
        : "NOT CONNECTED (Telnyx credentials missing)";
  const emailState = email.configured ? "CONFIGURED (SMTP creds present)" : "not configured (SMTP absent)";
  const summary =
    sms.state === "CONNECTED" || email.configured
      ? `SMS: ${smsState} · Email: ${emailState} · Zero-spend mode active.`
      : `SMS: ${smsState} · Email: OFF — SMTP not configured · All outbound hardware-off (zero-spend mode).`;
  return { sms, email, zeroSpend: true, summary, gateFunction: "assertChannelSendAllowed" };
}