// ─────────────────────────────────────────────────────────────────────────────
// DealForge Properties — Seller EMAIL SEND PIPELINE (gate-enforced, fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: This sends NO email today. It is the owner's safe way to email leads
// LATER. sendSellerEmail() calls the existing fail-closed channel gate FIRST
// (assertChannelSendAllowed in lib/channel-gates.ts) and throws on refusal.
// Because no SMTP provider is configured today (SMTP_HOST/SMTP_USER/SMTP_PASS
// absent, $0 spend mode), the gate refuses every send with gate='provider'.
//
// Gate order (fixed, from lib/channel-gates.ts):
//   1. provider — SMTP credentials configured?
//   2. campaign  — an owner-APPROVED channel_campaign approval exists for the
//                  campaignId (kind='channel_campaign', ref_type='campaign',
//                  status='approved') — the per-campaign on/off toggle.
//   3. compliance — the lead passes the existing matrix (has email, and is not
//                  opted_out / invalid_contact) via assertOutreachAllowed.
// A suppressed lead can NEVER be emailed, ever.
//
// When the gate passes, this module composes the chosen honest template from
// business_profile identity + stored lead facts, transmits via nodemailer,
// then writes the audit row + email_logs row, stamps last_contact_at and sets
// next_action_due for the next drip step. That path is currently unreachable
// (gate stays closed) but is kept correct so unlocking email is purely an
// owner action (see the report for the exact unlock steps).
// ─────────────────────────────────────────────────────────────────────────────
import { sql } from "~/db";
import { assertChannelSendAllowed, providerConfigStatus } from "~/lib/channel-gates";
import { getBusinessProfile, logOutreachAudit } from "~/lib/compliance";
import { hasApproval } from "~/lib/approvals";
import { assertOutreachAllowed, type OutreachCheckLead } from "~/lib/skip-trace";
import {
  EMAIL_TEMPLATE_BY_KEY,
  type SellerEmailIdentity,
  type SellerEmailLead,
  type SellerEmailTemplateKey,
} from "~/lib/email-templates";

/** Lead shape the send path needs: all the compliance fields the gate checks,
 *  plus the stored facts the templates may truthfully cite (name + property
 *  address from the leads table). Only stored fields are used — nothing is
 *  invented. */
export type SellerLead = OutreachCheckLead & SellerEmailLead & { id?: string | null };

/** Thrown when the fail-closed gate refuses a send. `gate` names the first
 *  unmet gate (provider | campaign | compliance); the message is the reason. */
export class SellerEmailBlockedError extends Error {
  readonly gate: string;
  constructor(gate: string, reason: string) {
    super(reason);
    this.name = "SellerEmailBlockedError";
    this.gate = gate;
  }
}

export type SendSellerEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

const FALLBACK_EMAIL = "dealforge-properties-8480c335@ctomail.io";

/**
 * Resolve the OPERATIONAL send/reply address for a seller email. This is the
 * inbox seller replies and opt-outs land in, so it must never resolve to a
 * paused/non-receivable inbox. Priority:
 *   1. process.env.EMAIL_FROM  — explicit override (in production the working
 *                                Gmail inbox, dealforgeproperties@gmail.com),
 *   2. process.env.SMTP_USER   — the authenticated sending account
 *                                (dealforgeproperties@gmail.com),
 *   3. business_profile.email  — the public brand identity, as today's fallback.
 *
 * The single resolved value is used for `from`, `replyTo` AND the template
 * identity's email (footer opt-out mailto), so all replies/opt-outs land in a
 * live mailbox rather than the cto inbox, which is provider-paused.
 */
export function resolveWorkingReplyAddress(profileEmail: string | null | undefined): string {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || profileEmail || FALLBACK_EMAIL;
}

function toIdentity(p: Awaited<ReturnType<typeof getBusinessProfile>>): SellerEmailIdentity {
  return {
    businessName: p.business_name || "DealForge Properties",
    contactName: p.contact_name,
    website: p.website,
    phone: p.phone,
    email: p.email,
    returnAddress: p.return_address,
  };
}

/**
 * Load a lead from the DB by id, mapping every column the gate + templates
 * need. Returns null when the lead does not exist.
 */
export async function loadSellerLead(leadId: string): Promise<SellerLead | null> {
  const rows = (await sql`
    SELECT id, email, phone, dnc_flag, do_not_mail, opted_out, invalid_contact, wrong_number,
           property_address, property_city, property_state, property_zip, full_name
    FROM leads WHERE id = ${leadId}
  `) as SellerLead[];
  return rows[0] ?? null;
}

/**
 * Compliance-led target filtering for a future campaign UI / drip scheduler.
 * Returns ONLY leads that would pass assertChannelSendAllowed('email', …)
 * TODAY. Because no SMTP provider is configured, this is [] today (honest).
 * Kept fully correct so it becomes useful the moment the owner unlocks email:
 *   * provider must be configured (else []),
 *   * the campaign must have an owner-approved channel_campaign approval
 *     (else []),
 *   * each lead must pass the email compliance matrix (has email, not
 *     suppressed) — an opted-out/invalid lead is never returned, ever.
 */
export async function emailableLeadIds(campaignId: string | null): Promise<string[]> {
  // Gate 1 — provider. Not configured today => nothing is emailable.
  if (!providerConfigStatus("email").configured) return [];
  // Gate 2 — owner-approved per-campaign channel approval.
  if (!campaignId) return [];
  const approved = await hasApproval("channel_campaign", "campaign", campaignId, ["approved"]);
  if (!approved) return [];
  // Gate 3 — per-lead compliance. Load only leads that carry an email, then
  // hard-filter through the same matrix the send path enforces.
  const rows = (await sql`
    SELECT id, email, opted_out, invalid_contact, wrong_number, dnc_flag, do_not_mail
    FROM leads
    WHERE email IS NOT NULL AND email <> ''
  `) as (OutreachCheckLead & { id: string })[];
  const ids: string[] = [];
  for (const r of rows) {
    if (assertOutreachAllowed(r, "email").allowed) ids.push(r.id);
  }
  return ids;
}

/**
 * Send a seller email through the fail-closed gate. The FIRST thing this does
 * is refuse (throw) unless EVERY gate passes — provider configured, campaign
 * owner-approved, lead email-compliant. Today it always throws
 * (gate='provider') because no SMTP provider is configured.
 *
 * @param lead   the seller lead (compliance fields + stored name/address facts)
 * @param opts   { campaignId, template } — campaignId REQUIRED (fail closed
 *               without it); template is one of 'initial' | 'follow1' |
 *               'follow2' | 'optout'.
 */
export async function sendSellerEmail(
  lead: SellerLead,
  opts: { campaignId: string | null; template: SellerEmailTemplateKey },
): Promise<SendSellerEmailResult> {
  // ── FAIL-CLOSED GATE — called FIRST, before any composition or side effect.
  const gate = await assertChannelSendAllowed("email", lead, { campaignId: opts.campaignId ?? "" });
  if (!gate.allowed) {
    throw new SellerEmailBlockedError(gate.gate, gate.reason);
  }

  // ── Gate passed (owner unlocked email). Compose + transmit + log ─────────
  const template = EMAIL_TEMPLATE_BY_KEY[opts.template];
  const profile = await getBusinessProfile();
  const identity = toIdentity(profile);
  const to = lead.email?.trim();
  if (!to) {
    throw new SellerEmailBlockedError("compliance", "Blocked: lead has no email address on file — nothing to send to.");
  }
  // Operational send/reply inbox, resolved by priority (EMAIL_FROM → SMTP_USER
  // → business_profile.email). Used for BOTH the SMTP from/replyTo AND the
  // template identity's email, so a seller's reply or opt-out (footer mailto)
  // lands in a LIVE inbox — never the provider-paused cto inbox.
  const workingEmail = resolveWorkingReplyAddress(profile.email);
  const sendIdentity: SellerEmailIdentity = { ...identity, email: workingEmail };
  const { subject, html, text } = {
    subject: template.subject(lead, sendIdentity),
    html: template.html(lead, sendIdentity),
    text: template.text(lead, sendIdentity),
  };

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  // Defense in depth — the provider gate is checked above, but never transmit
  // if credentials vanished mid-flight (env mutation between gate and send).
  if (!host || !user || !pass) {
    throw new SellerEmailBlockedError("provider", "Blocked: SMTP credentials not configured — email channel OFF.");
  }

  try {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    // From + Reply-To resolve to the working inbox (EMAIL_FROM → SMTP_USER →
    // profile email). Brand identity is preserved in the From display name;
    // the address itself is a live, receivable inbox so seller replies and
    // opt-outs (handleOptOut path) actually reach the owner.
    const from = `${identity.businessName} <${workingEmail}>`;
    // Reply-To = the same working address, so replies land where the owner
    // sees them (and can be routed into handleOptOut).
    const replyTo = workingEmail;
    const info = await transport.sendMail({ from, to, replyTo, subject, html, text });

    // Log every successful transmission (compliance-core audit trail).
    await logOutreachAudit({
      leadId: lead.id || null,
      channel: "email",
      direction: "outbound",
      status: "sent",
      contactValue: to,
      contentPreview: subject,
    });
    await sql`
      INSERT INTO email_logs (lead_id, to_email, subject, body, status, provider_id)
      VALUES (${lead.id || null}, ${to}, ${subject}, ${html}, 'sent', ${info.messageId})
    `;
    // Advance pre-contact leads to contact_attempted (status spine, B6).
    if (lead.id) {
      try {
        const { noteOutreachAttempt } = await import("~/lib/outreach-status");
        await noteOutreachAttempt(lead.id, "email", "sent");
      } catch {
        // never let the status bump break a send
      }
    }
    // Stamp last_contact_at and schedule the next drip step (next_action_due).
    if (lead.id) {
      const nextDays = template.followUpDays;
      if (nextDays != null) {
        await sql`
          UPDATE leads
          SET last_contact_at = now(),
              next_action = ${`Email follow-up (${opts.template} → next)`},
              next_action_due = now() + (${nextDays} * interval '1 day')
          WHERE id = ${lead.id}
        `;
      } else {
        await sql`
          UPDATE leads
          SET last_contact_at = now()
          WHERE id = ${lead.id}
        `;
      }
    }
    return { success: true, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    try {
      await logOutreachAudit({
        leadId: lead.id || null,
        channel: "email",
        direction: "outbound",
        status: "failed",
        reason: msg,
        contactValue: to,
        contentPreview: subject,
      });
      await sql`
        INSERT INTO email_logs (lead_id, to_email, subject, body, status, error)
        VALUES (${lead.id || null}, ${to}, ${subject}, ${html}, 'failed', ${msg})
      `;
    } catch {
      // audit/logging must never break the caller
    }
    return { success: false, error: msg };
  }
}

// Re-exported for convenience so callers can type lead facts against the same
// shape without importing from two modules.
export type { SellerEmailIdentity };
