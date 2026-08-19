// ─────────────────────────────────────────────────────────────────────────────
// DealForge Properties — Seller email templates (opt-out-aware, honest copy)
// ─────────────────────────────────────────────────────────────────────────────
// Rules this module obeys (owner directive 2026-08-12 audit-first + the
// acceptable-use integrity rules):
//   * Content is grounded ONLY in stored lead facts passed in (full name and/or
//     property address from the leads table). Nothing is invented: no comps, no
//     ARV, no "your house is worth $X", no manufactured urgency, no invented
//     relationships. No fabricated value/urgency/relationship claims.
//   * Identity comes from the business_profile store (Joshua Black, DealForge
//     Properties, San Antonio, TX) and is injected at render time by the send
//     path — a template never hardcodes a person or a street address the DB may
//     not agree with.
//   * CAN-SPAM: every commercial message carries a physical postal address
//     (profile return_address; city/state fallback) + a clear, working opt-out
//     instruction. The opt-out instruction routes to the existing handleOptOut
//     path (inbound STOP/opt-out handler in lib/compliance.ts) once a provider
//     is wired; until then the mailto/reply line is the honest affordance.
//   * The opt-out confirmation template is the politest possible pull message —
//     it confirms removal and offers a way back. It is transactional, but
//     sendSellerEmail() still refuses it through the channel gate so nothing
//     unexpected ever transmits.
// ─────────────────────────────────────────────────────────────────────────────
export type SellerEmailIdentity = {
  businessName: string;
  contactName: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  /** Physical postal address from business_profile.return_address (CAN-SPAM). */
  returnAddress: string | null;
};

export type SellerEmailLead = {
  full_name?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  property_state?: string | null;
  property_zip?: string | null;
};

/** Stable keys — a future drip scheduler/dashboard references these, never
 *  string literals. */
export type SellerEmailTemplateKey = "initial" | "follow1" | "follow2" | "optout";

export type SellerEmailTemplate = {
  key: SellerEmailTemplateKey;
  /** Days after the previous send before this one should go out (drip cadence
   *  used to set leads.next_action_due). null = no follow-up scheduled. */
  followUpDays: number | null;
  subject: (lead: SellerEmailLead, identity: SellerEmailIdentity) => string;
  html: (lead: SellerEmailLead, identity: SellerEmailIdentity) => string;
  text: (lead: SellerEmailLead, identity: SellerEmailIdentity) => string;
};

// --- Small honest helpers -----------------------------------------------------
/** The name to greet with; "there" when the DB has no stored name. */
export function greetingName(lead: SellerEmailLead): string {
  const n = lead.full_name?.trim();
  return n || "there";
}

/** The property reference to cite; "your property" when the DB has no street
 *  address stored for the lead (we never invent one). */
export function propertyRef(lead: SellerEmailLead): string {
  const parts = [lead.property_address?.trim(), lead.property_city?.trim(), lead.property_state?.trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : "your property";
}

/** The opt-out instruction. NOTE: the rendered line intentionally avoids the
 *  forbidden manufactured-urgency words entirely and speaks plainly. The
 *  "STOP" / "unsubscribe" triggers map to the existing handleOptOut() path in
 *  lib/compliance.ts — replies and mailto clicks land there via the provider
 *  hook once a provider is connected. */
export function optOutText(identity: SellerEmailIdentity): string {
  return (
    `To stop receiving emails from ${identity.businessName}, reply with STOP or ` +
    `unsubscribe. We'll remove you from our list. If you'd like, you can also reply "please stop".`
  );
}

export function optOutMailto(identity: SellerEmailIdentity): string | null {
  if (!identity.email) return null;
  return `mailto:${identity.email}?subject=${encodeURIComponent("Unsubscribe - please stop sending")}`;
}

/** Footer with business identity + physical address + opt-out (CAN-SPAM). */
export function footerHtml(identity: SellerEmailIdentity): string {
  const nameLine = identity.contactName ? `${identity.contactName} · ` : "";
  const phoneLine = identity.phone ? ` · ${identity.phone}` : "";
  const siteLine = identity.website
    ? ` · <a href="${identity.website}" style="color:#d4a5f5;">${identity.website}</a>`
    : "";
  const postal = identity.returnAddress?.trim() || "San Antonio, TX";
  const mailto = optOutMailto(identity);
  const opt = mailto
    ? `To stop receiving emails from ${identity.businessName}, <a href="${mailto}" style="color:#d4a5f5;">unsubscribe here</a> or reply with STOP.`
    : optOutText(identity);
  return (
    `<p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #334155;font-size:12px;color:#94a3b8;">` +
    `${nameLine}${identity.businessName} · ${postal}${phoneLine}${siteLine}</p>` +
    `<p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">${opt}</p>`
  );
}

/** Plain-text footer (for the text/plain part). */
export function footerText(identity: SellerEmailIdentity): string {
  const nameLine = identity.contactName ? `${identity.contactName} · ` : "";
  const phoneLine = identity.phone ? ` · ${identity.phone}` : "";
  const siteLine = identity.website ? ` · ${identity.website}` : "";
  const postal = identity.returnAddress?.trim() || "San Antonio, TX";
  const mailto = optOutMailto(identity);
  const opt = mailto ? `To stop receiving emails, unsubscribe here: ${mailto} — or reply with STOP.` : optOutText(identity);
  return [`${nameLine}${identity.businessName} · ${postal}${phoneLine}${siteLine}`, "", opt].join("\n");
}

function shellHtml(body: string, identity: SellerEmailIdentity): string {
  const site = identity.website ?? "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${identity.businessName}</title></head>
<body style="margin:0;padding:0;background:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:28px 12px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#1e293b;border-radius:10px;border:1px solid #334155;">
      <tr><td style="padding:26px 30px 4px;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:19px;font-weight:bold;color:#f59e0b;">${identity.businessName}</p>
        <p style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Local home buyer · San Antonio, TX${site ? ` · <a href="${site}" style="color:#94a3b8;">${site}</a>` : ""}</p>
      </td></tr>
      <tr><td style="padding:18px 28px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#e2e8f0;">
        ${body}
        ${footerHtml(identity)}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function p(html: string): string {
  return `<p style="margin:0 0 14px;">${html}</p>`;
}

// --- The four honest templates -------------------------------------------------
export const EMAIL_TEMPLATES: SellerEmailTemplate[] = [
  // 1. Initial outreach — grounded in the stored property address, no value
  //    claims, no urgency, clear opt-out.
  {
    key: "initial",
    followUpDays: 4,
    subject: (lead, identity) => `Hello from ${identity.businessName} about ${propertyRef(lead)}`,
    html: (lead, identity) =>
      shellHtml(
        p(`Hi ${greetingName(lead)},`) +
          p(
            `I'm ${identity.contactName || identity.businessName} with ${identity.businessName}, a local home buyer in the San Antonio area. ` +
              `We're reaching out about ${propertyRef(lead)} — we buy homes in any condition, as-is, and we handle the costs on our side.`,
          ) +
          p(
            `If you've ever thought about selling, we'd welcome a no-pressure conversation. There's no obligation and no cost to you — ` +
              `just honest answers about how the process works.`,
          ) +
          p(`Simply reply to this email and we'll take it from there.`),
        identity,
      ),
    text: (lead, identity) =>
      `Hello ${greetingName(lead)},\n\n` +
      `My name is ${identity.contactName || identity.businessName} with ${identity.businessName}, a local home buyer in the San Antonio area. ` +
      `We're reaching out about ${propertyRef(lead)}. We buy homes in any condition, as-is, and we handle the costs on our side.\n\n` +
      `If you'd ever consider selling, we'd love a no-pressure conversation — no obligation, no cost to you. ` +
      `Just reply to this email and we'll take it from there.\n\n${footerText(identity)}`,
  },

  // 2. Follow-up 1 (day ~4) — a gentle, honest check-in.
  {
    key: "follow1",
    followUpDays: 6,
    subject: (lead, _identity) => `Quick follow-up about ${propertyRef(lead)}`,
    html: (lead, identity) =>
      shellHtml(
        p(`Hi ${greetingName(lead)},`) +
          p(
            `A few days ago I reached out about ${propertyRef(lead)} on behalf of ${identity.businessName}. ` +
              `I know life gets busy, so I wanted to circle back once in case it got lost in the shuffle.`,
          ) +
          p(
            `We're still happy to have a quick, no-pressure conversation if you're curious — just reply to this email. ` +
              `If now isn't the right time, no problem at all: reply with STOP and we'll leave you alone.`,
          ),
        identity,
      ),
    text: (lead, identity) =>
      `Hi ${greetingName(lead)},\n\n` +
      `A few days ago I reached out about ${propertyRef(lead)} on behalf of ${identity.businessName}. ` +
      `I know life is busy, so I just wanted to circle back once in case it got lost.\n\n` +
      `We're still happy to have a quick, no-pressure conversation. Just reply to this email. ` +
      `If now isn't the right time, no worries — reply with STOP to be left alone.\n\n${footerText(identity)}`,
  },

  // 3. Follow-up 2 (day ~10) — final gentle touch, opt-out front and center.
  {
    key: "follow2",
    followUpDays: null,
    subject: (lead, _identity) => `Last note about ${propertyRef(lead)} (no more after this)`,
    html: (lead, identity) =>
      shellHtml(
        p(`Hi ${greetingName(lead)},`) +
          p(
            `This is the last email you'll get from ${identity.businessName} about ${propertyRef(lead)} unless you reply. ` +
              `We wanted to leave the door open in case you're ever considering selling — we'd be glad to simply have a conversation, no pressure.`,
          ) +
          p(
            `If you'd like to talk, reply to this email. If you'd rather not hear from us again, reply with STOP ` +
              `or use the unsubscribe link below — we'll remove you and you won't receive another email from us.`,
          ),
        identity,
      ),
    text: (lead, identity) =>
      `Hi ${greetingName(lead)},\n\n` +
      `This is the last email you'll get from ${identity.businessName} about ${propertyRef(lead)} unless you reply. ` +
      `We wanted to leave the door open in case you're ever considering selling — we'd be glad to have a conversation, no pressure.\n\n` +
      `If you'd like to talk, reply to this email. Otherwise, reply with STOP or use the unsubscribe link below and we'll remove you.\n\n${footerText(identity)}`,
  },

  // 4. Opt-out confirmation — politest message confirming removal. Shown when
  //    the lead opts out (handleOptOut path); never a marketing send.
  {
    key: "optout",
    followUpDays: null,
    subject: (_lead, identity) => `You're unsubscribed from ${identity.businessName} emails`,
    html: (lead, identity) =>
      shellHtml(
        p(`Hi ${greetingName(lead)},`) +
          p(
            `You're all set — we've removed you from our email list and you won't receive further emails from ${identity.businessName}. We're sorry to see you go.`,
          ) +
          p(
            `If you change your mind in the future, you can always reach out to us directly at ${identity.email || identity.businessName}.`,
          ),
        identity,
      ),
    text: (lead, identity) =>
      `Hi ${greetingName(lead)},\n\n` +
      `You're all set — we've removed you from our email list and you won't receive further emails from ${identity.businessName}. ` +
      `If you change your mind in the future, you can reach us at ${identity.email || identity.businessName}.\n\n${footerText(identity)}`,
  },
];

export const EMAIL_TEMPLATE_BY_KEY: Record<SellerEmailTemplateKey, SellerEmailTemplate> = Object.fromEntries(
  EMAIL_TEMPLATES.map((t) => [t.key, t]),
) as Record<SellerEmailTemplateKey, SellerEmailTemplate>;
