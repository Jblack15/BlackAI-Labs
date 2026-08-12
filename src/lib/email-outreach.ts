import { sql } from "~/db";

// ─────────────────────────────────────────────────────────────────────────────
// Email outreach drip — 5-email sequence built from the marketing team's
// campaign assets (section 3: Email Drip Sequence).
//   Email 1 (immediate) → Day 1 → Day 3 → Day 5 → Day 10
// Sends are tracked in `outreach_sequences` (channel='email') exactly like the
// SMS outreach: email 1 goes out immediately, steps 2–5 are scheduled rows.
// Every send is logged to `email_logs` (mirror of `sms_logs`).
// ─────────────────────────────────────────────────────────────────────────────

// Public business site used in seller-facing email links. Never embed a raw
// platform URL (owner directive). No email is sent until SITE_URL is set to the
// real public site — sendEmail refuses to send when it is missing, so a
// placeholder or internal URL can never reach a seller.
const SITE_URL = process.env.SITE_URL || "";
// One-click opt-out destination. Replace with the production unsubscribe handler when available.
const UNSUBSCRIBE_URL = "mailto:dealforge-properties-8480c335@ctomail.io?subject=Unsubscribe";
const UNSUBSCRIBE_TEXT = `To unsubscribe, reply STOP or click here: ${UNSUBSCRIBE_URL}`;

export interface EmailTemplate {
  subject: (name: string, address: string) => string;
  html: (name: string, address: string) => string;
  text: (name: string, address: string) => string;
}

export type EmailResult = { success: boolean; messageId?: string; error?: string };

// --- HTML rendering helpers (inline styles for email clients) ---------------

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:8px;background:#f59e0b;"><a href="${url}" style="display:inline-block;padding:12px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#0a1628;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

function emailShell(bodyHtml: string, preview: string): string {
  const unsubscribeHtml = `<p style="margin:16px 0 0;font-size:12px;color:#7c93b5;">To unsubscribe, reply STOP or <a href="${UNSUBSCRIBE_URL}" style="color:#f59e0b;">click here</a>.</p>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DealForge Properties</title></head>
<body style="margin:0;padding:0;background:#0a1628;">
  <div style="display:none;max-height:0;overflow:hidden;">${preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#10203a;border-radius:12px;border:1px solid #1e3a5f;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#f59e0b;">DealForge Properties</p>
          <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#7c93b5;">Sell Your House Fast For Cash</p>
        </td></tr>
        <tr><td style="padding:16px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#dbe7f5;">
          ${bodyHtml}
          <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #1e3a5f;font-size:12px;color:#7c93b5;">DealForge Properties · San Antonio, TX · <a href="${SITE_URL}" style="color:#f59e0b;">${SITE_URL}</a></p>
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

// --- The 5-email drip --------------------------------------------------------

export const EMAIL_SEQUENCE: EmailTemplate[] = [
  // Email 1 — immediate
  {
    subject: (name) => `Your cash offer request — we're on it, ${name}`,
    html: (name, address) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`Thanks for reaching out about selling <strong>${address}</strong>. We received your request and our team is already reviewing your property details.`) +
          block(`Here's the short version of how this works: We evaluate your home using our deal analysis process — factoring in location, condition, and comparable sales — then we make you a fair, no-obligation cash offer. You decide if it works for you. No pressure, no games.`) +
          block(`We'll call you shortly to ask a few quick questions about the property. In the meantime, if you want to see how our offer calculator works, you can estimate your offer here:`) +
          ctaButton("Estimate My Offer →", `${SITE_URL}/calculator`) +
          block(`<em style="color:#7c93b5;">P.S. Have your phone nearby — we'll be in touch shortly.</em>`),
        `We got your info for ${address}. Here's what happens next.`,
      ),
    text: (name, address) =>
      `Hi ${name},\n\nThanks for reaching out about selling ${address}. We received your request and our team is already reviewing your property details.\n\nWe evaluate your home using our deal analysis process — location, condition, comparable sales — then we make you a fair, no-obligation cash offer. No pressure, no games.\n\nEstimate your offer: ${SITE_URL}/calculator\n\nP.S. Have your phone nearby — we'll be in touch shortly.`,
  },
  // Email 2 — day 1
  {
    subject: () => `Selling your house in 7 days — here's exactly how`,
    html: (name, address) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`I wanted to walk you through exactly how DealForge Properties works — because we do things differently than the traditional route.`) +
          steps([
            `<strong>Get Your Offer.</strong> We evaluate ${address} and present you a fair cash offer within 24 hours. No waiting weeks for an appraisal.`,
            `<strong>Accept on Your Timeline.</strong> Like the offer? Great. We close in as little as 7 days. Need more time? We can work with your schedule — 14, 21, or even 30 days out.`,
            `<strong>Get Paid.</strong> We handle all the paperwork, coordinate with the title company, and you walk away with cash in hand. No repairs, no cleaning, no realtor fees eating 6% of your sale.`,
          ]) +
          block(`That's it. Three steps, one week, and you're free from a property that's been weighing you down.`) +
          ctaButton("Get My Cash Offer →", `${SITE_URL}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. We buy homes in any condition — hoarder houses, fire damage, foundation issues, outdated from top to bottom. If you own it, we'll make an offer.</em>`),
        `No repairs. No commissions. No waiting. Just a fair cash offer and a fast close.`,
      ),
    text: (name, address) =>
      `Hi ${name},\n\nHere's exactly how DealForge Properties works:\n\nStep 1: Get Your Offer. We evaluate ${address} and present a fair cash offer within 24 hours.\nStep 2: Accept on Your Timeline. Close in as little as 7 days — or 14, 21, even 30 days out.\nStep 3: Get Paid. We handle all the paperwork, coordinate the title company, you walk away with cash.\n\nNo repairs, no cleaning, no realtor fees.\n\nGet your offer: ${SITE_URL}/get-offer\n\nP.S. We buy homes in any condition.`,
  },
  // Email 3 — day 3
  {
    subject: (_, address) => `Just checking in about ${address}`,
    html: (name, address) =>
      emailShell(
        block(`Hi ${name},`) +
          block(`We know selling a house — especially one that needs work — can feel like a gamble. So here's what we keep simple: we look at the property, run the numbers, and make you a fair, no-obligation cash offer. You decide. No pressure, no games.`) +
          block(`We're still ready to make you an offer on <strong>${address}</strong>. If you'd like to see what the house is worth to us, just reply to this email or use the link below.`) +
          ctaButton("See My Offer →", `${SITE_URL}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. We'll share real seller stories here as our deals close. Until then, no hype — just a straight offer when you're ready.</em>`),
        `Just checking in about ${address}. We're here when you're ready.`,
      ),
    text: (name, address) =>
      `Hi ${name},\n\nWe know selling a house — especially one that needs work — can feel like a gamble. That's why we keep it simple: we look at the property, run the numbers, and make you a fair, no-obligation cash offer. You decide.\n\nWe're still ready to make you an offer on ${address}. Reply to this email or use the link below.\n\nSee your offer: ${SITE_URL}/get-offer\n\nP.S. We'll share real seller stories here as our deals close. Until then, no hype — just a straight offer.`,
  },
  // Email 4 — day 5
  {
    subject: (name, address) => `${name}, your cash offer for ${address} is waiting`,
    html: (name, address) =>
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
          ctaButton("Get My Offer Now →", `${SITE_URL}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. Rates change, markets shift, and circumstances don't wait. Your offer is valid for 30 days — but the sooner you act, the sooner you can move on.</em>`),
        `We're ready when you are. Close in 7 days. No repairs. No fees.`,
      ),
    text: (name, address) =>
      `Hi ${name},\n\nWe're still here and we're still ready to make you a cash offer on ${address}.\n\nWaiting costs you: taxes, insurance, utilities, maintenance, market risk.\n\nWe offer: a fair cash offer within 24 hours, close in as little as 7 days, zero repairs/commissions/closing costs.\n\nNo obligation. Get your offer: ${SITE_URL}/get-offer\n\nP.S. Your offer is valid for 30 days.`,
  },
  // Email 5 — day 10
  {
    subject: (_, address) => `Final call — your cash offer for ${address}`,
    html: (name, address) =>
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
          ctaButton("One Last Look: Get My Offer →", `${SITE_URL}/get-offer`) +
          block(`<em style="color:#7c93b5;">P.S. If you ever change your mind, our offer stands for 30 days from your original submission. Just reply to this email and we'll pick up right where we left off.</em>`),
        `This is our last email. Here's one last chance to turn that house into cash.`,
      ),
    text: (name, address) =>
      `Hi ${name},\n\nThis is my final note — after today you won't hear from us again about ${address} unless you reach out first.\n\nIf the house is costing you more than it's worth, you need cash, you're done being a landlord, or you're facing a deadline — don't let this opportunity pass.\n\nWe close in 7 days and buy as-is. No risk, no obligation.\n\nOne last look: ${SITE_URL}/get-offer\n\nP.S. Our offer stands for 30 days from your original submission.`,
  },
];

// --- Sending -----------------------------------------------------------------

function withUnsubscribeText(text: string): string {
  return `${text}\n\n${UNSUBSCRIBE_TEXT}`;
}

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
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  leadId?: string;
}): Promise<EmailResult> {
  // Hard block (PH1-B1): nothing sends to a known lead without contact info or
  // with a suppression flag. Fails closed if the check itself errors.
  if (opts.leadId) {
    try {
      const { assertLeadOutreachAllowedById } = await import("~/lib/skip-trace");
      const check = await assertLeadOutreachAllowedById(opts.leadId);
      if (!check.allowed) {
        await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: check.reason });
        return { success: false, error: check.reason };
      }
    } catch {
      await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: "Blocked: could not verify contact/compliance clearance for lead" });
      return { success: false, error: "Blocked: could not verify contact/compliance clearance for lead" };
    }
  }
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  // Never send an email whose links would point at a placeholder or internal
  // URL. SITE_URL must be the real public business site before any send.
  if (!SITE_URL) {
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: "SITE_URL not configured" });
    return { success: false, error: "SITE_URL not configured — email not sent (set SITE_URL to the public business site)" };
  }
  // Bulk email is restricted to verified/consented contacts (form submitters),
  // never every lead merely because a record contains an email address.
  if (!host || !user || !pass) {
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "failed", error: "Email not configured" });
    return { success: false, error: "Email not configured — add SMTP_HOST, SMTP_USER, SMTP_PASS (optionally SMTP_PORT, EMAIL_FROM)" };
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
    const from = process.env.EMAIL_FROM || "DealForge Properties <dealforge-properties-8480c335@ctomail.io>";
    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: withUnsubscribeText(opts.text || ""),
    });
    await logEmail({ leadId: opts.leadId, to: opts.to, subject: opts.subject, body: opts.html, status: "sent", providerId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
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
