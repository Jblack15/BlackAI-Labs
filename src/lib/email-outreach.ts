import { sql } from "~/db";

// ─────────────────────────────────────────────────────────────────────────────
// Email outreach drip — 5-email sequence built from the marketing team's
// campaign assets (section 3: Email Drip Sequence).
//   Email 1 (immediate) → Day 1 → Day 3 → Day 5 → Day 10
// Sends are tracked in `outreach_sequences` (channel='email') exactly like the
// SMS outreach: email 1 goes out immediately, steps 2–5 are scheduled rows.
// Every send is logged to `email_logs` (mirror of `sms_logs`) and every
// attempt — sent or blocked — is logged to `outreach_audit_log` (compliance
// core, PH1-B2).
// ─────────────────────────────────────────────────────────────────────────────

// Business identity comes from the business_profile table (Settings →
// Compliance → Business identity). The identity guard refuses to send until
// business_name + website are configured — nothing ever renders a placeholder
// name or a raw/internal URL to a seller. SITE_URL env remains as a last-resort
// fallback only for the website value; the guard still requires it non-empty.
const SITE_URL = process.env.SITE_URL || "";
// One-click opt-out destination (mailto). When the profile has an email
// address, that address is used; otherwise the platform email fallback.
const UNSUBSCRIBE_EMAIL_FALLBACK = "dealforge-properties-8480c335@ctomail.io";

export type EmailIdentity = {
  businessName: string;
  website: string;
  phone: string | null;
  email: string | null;
  returnAddress: string | null;
};

export interface EmailTemplate {
  subject: (name: string, address: string, identity?: EmailIdentity) => string;
  html: (name: string, address: string, identity?: EmailIdentity) => string;
  text: (name: string, address: string, identity?: EmailIdentity) => string;
}

export type EmailResult = { success: boolean; messageId?: string; error?: string };

// --- HTML rendering helpers (inline styles for email clients) ---------------

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:8px;background:#f59e0b;"><a href="${url}" style="display:inline-block;padding:12px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#0a1628;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

function emailShell(bodyHtml: string, preview: string, identity?: EmailIdentity): string {
  const businessName = identity?.businessName || "DealForge Properties";
  const website = identity?.website || SITE_URL;
  const phone = identity?.phone || null;
  const profileEmail = identity?.email || null;
  const siteLink = website ? ` · <a href="${website}" style="color:#f59e0b;">${website}</a>` : "";
  const phoneLine = phone ? ` · ${phone}` : "";
  const unsubscribeEmail = profileEmail || UNSUBSCRIBE_EMAIL_FALLBACK;
  const unsubscribeHtml = `<p style="margin:16px 0 0;font-size:12px;color:#7c93b5;">To unsubscribe, reply STOP or <a href="mailto:${unsubscribeEmail}?subject=Unsubscribe" style="color:#f59e0b;">click here</a>.</p>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${businessName}</title></head>
<body style="margin:0;padding:0;background:#0a1628;">
  <div style="display:none;max-height:0;overflow:hidden;">${preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#10203a;border-radius:12px;border:1px solid #1e3a5f;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#f59e0b;">${businessName}</p>
          <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#7c93b5;">Sell Your House Fast For Cash</p>
        </td></tr>
        <tr><td style="padding:16px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#dbe7f5;">
          ${bodyHtml}
          <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #1e3a5f;font-size:12px;color:#7c93b5;">${businessName} · San Antonio, TX${phoneLine}${siteLink}</p>
          ${unsubscribeHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function block(text: string): string {
  return `<p style="margin:0 0 16px;">${text}</p>`;
}

function bullets(items: string[], negative = false): string {
  const rows = items.map((i) => `<tr><td style="padding:3px 0;font-family:Arial,sans-serif;font-size:14px;color:#dbe7f5;">${negative ? "❌" : "✅"}&nbsp; ${i}</td></tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${rows}</table>`;
}

function steps(items: string[]): string {
  const rows = items.map((s, i) => `<tr><td style="padding:4px 0;font-family:Arial,sans-serif;font-size:14px;color:#dbe7f5;"><strong style="color:#f59e0b;">Step ${i + 1}:</strong> ${s}</td></tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${rows}</table>`;
}

/** Website to use in template links — profile first, SITE_URL env as fallback. */
function site(identity?: EmailIdentity): string {
  if (identity?.website) return identity.website;
  return SITE_URL;
}

// --- The 5-email drip --------------------------------------------------------

export const EMAIL_SEQUENCE: EmailTemplate[] = [
  // Email 1 — immediate
  {
    subject: (name) => `Your cash offer request — we're on it, ${name}`,
    html: (name, address, identity) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`Thanks for reaching out about selling <strong>${address}</strong>. We received your request and our team is already reviewing your property details.`) +
          block(`Here's the short version of how this works: We evaluate your home using our deal analysis process — factoring in location, condition, and comparable sales — then we make you a fair, no-obligation cash offer. You decide if it works for you. No pressure, no games.`) +
          block(`We'll call you shortly to ask a few quick questions about the property. In the meantime, if you want to see how our offer calculator works, you can estimate your offer here:`) +
          ctaButton("Estimate My Offer →", `${site(identity)}/calculator`) +
          block(`<em style="color:#7c93b5;">P.S. Have your phone nearby — we'll be in touch shortly.</em>`),
        `We got your info for ${address}. Here's what happens next.`,
        identity!,
      ),
    text: (name, address, identity) =>
      `Hi ${name},\n\nThanks for reaching out about selling ${address}. We received your request and our team is already reviewing your property details.\n\nWe evaluate your home using our deal analysis process — location, condition, comparable sales — then we make you a fair, no-obligation cash offer. No pressure, no games.\n\nEstimate your offer: ${site(identity)}/calculator\n\nP.S. Have your phone nearby — we'll be in touch shortly.`,
  },
  // Email 2 — day 1
  {
    subject: () => `Selling your house in 7 days — here's exactly how`,
    html: (name, address, identity) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`I wanted to walk you through exactly how ${identity?.businessName || "DealForge Properties"} works — because we do things differently than the traditional route.`) +
          steps([
            `<strong>Get Your Offer.</strong> We evaluate ${address} and present you a fair cash offer within 24 hours. No waiting weeks for an appraisal.`,
            `<strong>Accept on Your Timeline.</strong> Like the offer? Great. We close in as little as 7 days. Need more time? We can work with your schedule — 14, 21, or even 30 days out.`,
            `<strong>Get Paid.</strong> We handle all the paperwork, coordinate with the title company, and you walk away with cash in hand. No repairs, no cleaning, no realtor fees eating 6% of your sale.`,
          ]) +
          block(`That's it. Three steps, one week, and you're free from a property that's been weighing you down.`) +
          ctaButton("Get My Cash Offer →", `${site(identity)}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. We buy homes in any condition — hoarder houses, fire damage, foundation issues, outdated from top to bottom. If you own it, we'll make an offer.</em>`),
        `No repairs. No commissions. No waiting. Just a fair cash offer and a fast close.`,
        identity!,
      ),
    text: (name, address, identity) =>
      `Hi ${name},\n\nHere's exactly how ${identity?.businessName || "DealForge Properties"} works:\n\nStep 1: Get Your Offer. We evaluate ${address} and present a fair cash offer within 24 hours.\nStep 2: Accept on Your Timeline. Close in as little as 7 days — or 14, 21, even 30 days out.\nStep 3: Get Paid. We handle all the paperwork, coordinate the title company, you walk away with cash.\n\nNo repairs, no cleaning, no realtor fees.\n\nGet your offer: ${site(identity)}/get-offer\n\nP.S. We buy homes in any condition.`,
  },
  // Email 3 — day 3
  {
    subject: (_, address) => `Just checking in about ${address}`,
    html: (name, address, identity) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`We know selling a house — especially one that needs work — can feel like a gamble. So here's what we keep simple: we look at the property, run the numbers, and make you a fair, no-obligation cash offer. You decide. No pressure, no games.`) +
          block(`We're still ready to make you an offer on <strong>${address}</strong>. If you'd like to see what the house is worth to us, just reply to this email or use the link below.`) +
          ctaButton("See My Offer →", `${site(identity)}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. We'll share real seller stories here as our deals close. Until then, no hype — just a straight offer when you're ready.</em>`),
        `Just checking in about ${address}. We're here when you're ready.`,
        identity!,
      ),
    text: (name, address, identity) =>
      `Hi ${name},\n\nWe know selling a house — especially one that needs work — can feel like a gamble. That's why we keep it simple: we look at the property, run the numbers, and make you a fair, no-obligation cash offer. You decide.\n\nWe're still ready to make you an offer on ${address}. Reply to this email or use the link below.\n\nSee your offer: ${site(identity)}/get-offer\n\nP.S. We'll share real seller stories here as our deals close. Until then, no hype — just a straight offer.`,
  },
  // Email 4 — day 5
  {
    subject: (name, address) => `${name}, your cash offer for ${address} is waiting`,
    html: (name, address, identity) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`I'll get straight to the point — we're still here and we're still ready to make you a cash offer on <strong>${address}</strong>.`) +
          block(`Here's what you're leaving on the table by waiting:`) +
          bullets([
            `Another month of property taxes, insurance, and utilities`,
            `More time worrying about maintenance and repairs`,
            `The risk that the market shifts and your value drops`,
            `The stress of not knowing when or if you'll sell`,
          ], true) +
          block(`Here's what we're offering:`) +
          bullets([
            `A fair cash offer within 24 hours`,
            `Close in as little as 7 days`,
            `Zero repairs, zero commissions, zero closing costs`,
            `Walk away with cash in hand`,
          ]) +
          block(`There's no obligation to accept our offer. But you'll never know what your house is worth to us until you get it.`) +
          ctaButton("Get My Offer Now →", `${site(identity)}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. Rates change, markets shift, and circumstances don't wait. Your offer is valid for 30 days — but the sooner you act, the sooner you can move on.</em>`),
        `We're ready when you are. Close in 7 days. No repairs. No fees.`,
        identity!,
      ),
    text: (name, address, identity) =>
      `Hi ${name},\n\nWe're still here and we're still ready to make you a cash offer on ${address}.\n\nWaiting costs you: taxes, insurance, utilities, maintenance, market risk.\n\nWe offer: a fair cash offer within 24 hours, close in as little as 7 days, zero repairs/commissions/closing costs.\n\nNo obligation. Get your offer: ${site(identity)}/get-offer\n\nP.S. Your offer is valid for 30 days.`,
  },
  // Email 5 — day 10
  {
    subject: (_, address) => `Final call — your cash offer for ${address}`,
    html: (name, address, identity) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`This is my final note. I don't want to clutter your inbox, so after today you won't hear from us again about <strong>${address}</strong> — unless you reach out first.`) +
          block(`I understand that selling isn't always an easy decision. But if any of these apply to you, please don't let this opportunity pass:`) +
          bullets([
            `The house is costing you more than it's worth to keep`,
            `You need cash now for something more important`,
            `You're tired of being a landlord or dealing with an inherited property`,
            `You're facing a deadline — tax sale, foreclosure, relocation`,
          ]) +
          block(`We close in 7 days and buy as-is. No risk, no obligation to get an offer. If now isn't the right time, save this email and reach out when you're ready.`) +
          block(`Either way, I wish you the best.`) +
          ctaButton("One Last Look: Get My Offer →", `${site(identity)}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. If you ever change your mind, our offer stands for 30 days from your original submission. Just reply to this email and we'll pick up right where we left off.</em>`),
        `This is our last email. Here's one last chance to turn that house into cash.`,
        identity!,
      ),
    text: (name, address, identity) =>
      `Hi ${name},\n\nThis is my final note — after today you won't hear from us again about ${address} unless you reach out first.\n\nIf the house is costing you more than it's worth, you need cash, you're done being a landlord, or you're facing a deadline — don't let this opportunity pass.\n\nWe close in 7 days and buy as-is. No risk, no obligation.\n\nOne last look: ${site(identity)}/get-offer\n\nP.S. Our offer stands for 30 days from your original submission.`,
  },
];

// --- Sending -----------------------------------------------------------------

async function logEmail(opts: {
  leadId?: string;
  to: string;
  subject: string;
  body: string;
  status: string;
  providerId?: string;
  error?: string;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO email_logs (lead_id, to_email, subject, body, status, provider_id, error)
      VALUES (${opts.leadId || null}, ${opts.to}, ${opts.subject}, ${opts.body}, ${opts.status}, ${opts.providerId || null}, ${opts.error || null})
    `;
  } catch {
    // Never let logging failure break the caller
  }
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Send a single email via SMTP. If SMTP credentials are missing (or sending
 * fails), the attempt is logged to email_logs as 'failed' and we return a
 * graceful error — never throw.
 *
 * Compliance (PH1-B2): every attempt is written to outreach_audit_log.
 * Blocks before sending when:
 *   - the lead is suppressed on the email channel (opted_out / invalid /
 *     wrong-number) or has no email — assertLeadOutreachAllowedById("email")
 *   - the business identity is not configured (business_name/website empty) —
 *     nothing renders a placeholder name or internal URL to a seller
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  leadId?: string;
}): Promise<EmailResult> {
  const { logOutreachAudit, assertBusinessIdentity, getBusinessProfile } = await import("~/lib/compliance");
  // Identity guard first — no send can render a placeholder identity.
  const identityCheck = await assertBusinessIdentity("email");
  if (!identityCheck.allowed) {
    await logOutreachAudit({
      leadId: opts.leadId || null,
      channel: "email",
      direction: "outbound",
      status: "blocked",
      reason: identityCheck.reason,
      contactValue: opts.to,
      contentPreview: opts.subject,
    });
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: identityCheck.reason });
    return { success: false, error: identityCheck.reason };
  }
  const profile = await getBusinessProfile();
  const identity: EmailIdentity = {
    businessName: profile.business_name || "DealForge Properties",
    website: profile.website || SITE_URL,
    phone: profile.phone,
    email: profile.email,
    returnAddress: profile.return_address,
  };
  // Hard block (PH1-B1 + B2): nothing sends to a known lead without contact
  // info or with a suppression flag. Fails closed if the check itself errors.
  if (opts.leadId) {
    try {
      const { assertLeadOutreachAllowedById } = await import("~/lib/skip-trace");
      const check = await assertLeadOutreachAllowedById(opts.leadId, "email");
      if (!check.allowed) {
        await logOutreachAudit({
          leadId: opts.leadId,
          channel: "email",
          direction: "outbound",
          status: "blocked",
          reason: check.reason,
          contactValue: opts.to,
          contentPreview: opts.subject,
        });
        await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: check.reason });
        return { success: false, error: check.reason };
      }
    } catch {
      await logOutreachAudit({
        leadId: opts.leadId,
        channel: "email",
        direction: "outbound",
        status: "blocked",
        reason: "Blocked: could not verify contact/compliance clearance for lead",
        contactValue: opts.to,
        contentPreview: opts.subject,
      });
      await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: "Blocked: could not verify contact/compliance clearance for lead" });
      return { success: false, error: "Blocked: could not verify contact/compliance clearance for lead" };
    }
  }
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  // Never send an email whose links would point at a placeholder or internal
  // URL. The identity guard already requires profile.website; double-check the
  // resolved value so a broken fallback can never slip through.
  if (!identity.website) {
    const reason = "Blocked: business identity not configured (website empty) — fill business identity in Settings before any outbound email send";
    await logOutreachAudit({ leadId: opts.leadId || null, channel: "email", direction: "outbound", status: "blocked", reason, contactValue: opts.to, contentPreview: opts.subject });
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: reason });
    return { success: false, error: reason };
  }
  // Bulk email is restricted to verified/consented contacts (form submitters),
  // never every lead merely because a record contains an email address.
  if (!host || !user || !pass) {
    const reason = "Email not configured — add SMTP_HOST, SMTP_USER, SMTP_PASS (optionally SMTP_PORT, EMAIL_FROM)";
    await logOutreachAudit({ leadId: opts.leadId || null, channel: "email", direction: "outbound", status: "failed", reason, contactValue: opts.to, contentPreview: opts.subject });
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: reason });
    return { success: false, error: reason };
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
    const from = profile.email || process.env.EMAIL_FROM || `${identity.businessName} <${UNSUBSCRIBE_EMAIL_FALLBACK}>`;
    const unsubscribeEmail = profile.email || UNSUBSCRIBE_EMAIL_FALLBACK;
    const unsubscribeText = `To unsubscribe, reply STOP or click here: mailto:${unsubscribeEmail}?subject=Unsubscribe`;
    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: `${opts.text || ""}\n\n${unsubscribeText}`,
    });
    await logOutreachAudit({
      leadId: opts.leadId || null,
      channel: "email",
      direction: "outbound",
      status: "sent",
      contactValue: opts.to,
      contentPreview: opts.subject,
    });
    // Outreach status spine (PH1-B6): a real transmission advances pre-contact
    // leads to contact_attempted. Guarded — the bump must never break the send.
    if (opts.leadId) {
      try {
        const { noteOutreachAttempt } = await import("~/lib/outreach-status");
        await noteOutreachAttempt(opts.leadId, "email", "sent");
      } catch {
        // never let the status bump break a send
      }
    }
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "sent", providerId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await logOutreachAudit({ leadId: opts.leadId || null, channel: "email", direction: "outbound", status: "failed", reason: msg, contactValue: opts.to, contentPreview: opts.subject });
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: msg });
    return { success: false, error: msg };
  }
}

// --- Drip orchestration ------------------------------------------------------

/**
 * Start the email drip for one lead: send Email 1 immediately and schedule
 * steps 2–5 (day 1, 3, 5, 10) in outreach_sequences — same pattern as SMS.
 */
export async function startEmailOutreach(leadId: string): Promise<EmailResult & { scheduled?: number }> {
  const rows = (await sql`
    SELECT full_name, email, property_address, property_city, property_state
    FROM leads WHERE id = ${leadId}
  `) as { full_name: string; email: string | null; property_address: string; property_city: string; property_state: string }[];
  const lead = rows[0];
  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.email) return { success: false, error: "Lead has no email address" };

  const address = `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`;
  const email1 = EMAIL_SEQUENCE[0];
  const result = await sendEmail({
    to: lead.email,
    subject: email1.subject(lead.full_name, address),
    html: email1.html(lead.full_name, address),
    text: email1.text(lead.full_name, address),
    leadId,
  });
  if (!result.success) return result;

  let scheduled = 0;
  for (const [step, days] of [[2, 1], [3, 3], [4, 5], [5, 10]] as const) {
    await sql`
      INSERT INTO outreach_sequences (lead_id, channel, step, status, scheduled_for)
      VALUES (${leadId}, 'email', ${step}, 'scheduled', now() + (${days} * interval '1 day'))
      ON CONFLICT DO NOTHING
    `;
    scheduled++;
  }
  return { success: true, messageId: result.messageId, scheduled };
}

/** Start the email drip for every qualified lead that has an email address. */
export async function startBulkEmailOutreach(): Promise<{ success: boolean; started: number; error?: string }> {
  const rows = (await sql`
    SELECT id FROM leads
    WHERE status = 'qualified' AND email IS NOT NULL AND email <> ''
      AND contactable = true
  `) as { id: string }[];
  let started = 0;
  for (const row of rows) {
    const r = await startEmailOutreach(row.id);
    if (r.success) started++;
  }
  return { success: true, started };
}
