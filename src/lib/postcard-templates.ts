// ─────────────────────────────────────────────────────────────────────────────
// DealForge Properties — Click2Mail postcard templates.
//
// Four campaigns, each a 6×9 postcard (front = message, back = steps + mailing
// address block). Adapted from the designer's direct-mail-postcard.html brand
// asset (navy #0A1628 / gold #C8A951).
//
// Merge fields (Click2Mail mail-merge syntax, also substituted server-side):
//   {{name}} {{address}} {{city}} {{state}} {{zip}}
//
// The `.address-block` region on the back is where Click2Mail expects the
// recipient address (bottom-right of the back panel for 6×9). The return
// address is printed on the front top-left. Keep the address block clear of
// artwork so USPS OCR stays accurate.
// ─────────────────────────────────────────────────────────────────────────────

export type PostcardCampaign = "general" | "pre-foreclosure" | "probate" | "tax-delinquent";

export interface PostcardTemplate {
  /** Machine id, used in mail_logs.template. */
  id: string;
  /** Human label shown in the CRM. */
  label: string;
  /** 6×9 postcard front — the marketing message. */
  front: string;
  /** 6×9 postcard back — how-it-works + address block. */
  back: string;
}

const NAVY = "#0A1628";
const NAVY_SOFT = "#10203A";
const GOLD = "#C8A951";
const GOLD_DARK = "#A8862F";
const TEXT = "#E2E8F0";
const MUTED = "#94A3B8";
// Placeholders — the real business phone and website must be configured by the
// operator before any postcard is printed. Never hardcode an unverified number
// or domain.
const PHONE = "[PHONE]";
const WEBSITE = "[WEBSITE]";

/** Brand header used on the front of every template. */
function frontHeader(badge: string): string {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,${GOLD},#E6C86E);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;font-weight:800;font-size:16px;color:${NAVY};">DF</div>
        <div style="font-family:Arial,sans-serif;font-size:19px;font-weight:700;color:#FFFFFF;">Deal<span style="color:${GOLD};">Forge</span> Properties</div>
      </div>
      <div style="background:rgba(200,169,81,0.15);border:1px solid rgba(200,169,81,0.35);border-radius:6px;padding:5px 12px;font-family:Arial,sans-serif;font-size:12px;font-weight:600;color:${GOLD};text-transform:uppercase;letter-spacing:0.5px;">${badge}</div>
    </div>`;
}

/** Front CTA footer: trust pills + phone/website. */
function frontFooter(pills: string[]): string {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="display:flex;gap:10px;">
        ${pills
          .map(
            (p) =>
              `<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:5px 14px;font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.75);">${p}</span>`,
          )
          .join("")}
      </div>
      <div style="text-align:right;">
        <div style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:${GOLD};">${PHONE}</div>
        <div style="font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.55);">${WEBSITE}</div>
      </div>
    </div>`;
}

/** Full front panel: navy background, centered headline, promise box. */
function frontPanel(badge: string, addressLine: string, headline: string, accent: string, promise: string, pills: string[]): string {
  return `
    <div style="width:6in;height:4.5in;background:${NAVY};border-radius:4px;box-sizing:border-box;padding:34px 40px;display:flex;flex-direction:column;justify-content:space-between;font-family:Arial,sans-serif;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-60px;right:-40px;width:280px;height:280px;border:3px solid rgba(200,169,81,0.18);border-radius:50%;pointer-events:none;"></div>
      ${frontHeader(badge)}
      <div style="text-align:center;position:relative;">
        <div style="font-size:15px;color:rgba(255,255,255,0.55);margin-bottom:10px;">RE: <strong style="color:rgba(255,255,255,0.75);">${addressLine}</strong></div>
        <div style="font-size:34px;font-weight:800;color:#FFFFFF;line-height:1.15;letter-spacing:-0.5px;">${headline}</div>
        <div style="font-size:36px;font-weight:800;color:${GOLD};line-height:1.1;margin-top:4px;">${accent}</div>
        <div style="margin-top:16px;display:inline-block;background:rgba(200,169,81,0.10);border:1px solid rgba(200,169,81,0.25);border-radius:10px;padding:12px 24px;">
          <div style="font-size:15px;color:${TEXT};line-height:1.5;">${promise}</div>
        </div>
      </div>
      ${frontFooter(pills)}
    </div>`;
}

/** Back panel: how-it-works steps + USPS address block bottom-right. */
function backPanel(steps: { num: string; title: string; body: string }[]): string {
  return `
    <div style="width:6in;height:4.5in;background:#F8FAFC;border-radius:4px;box-sizing:border-box;padding:30px 40px;font-family:Arial,sans-serif;position:relative;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;">
        <div style="font-size:20px;font-weight:700;color:${NAVY};">Deal<span style="color:${GOLD_DARK};">Forge</span> Properties</div>
        <div style="background:${NAVY};color:${GOLD};border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">How It Works</div>
      </div>
      <div style="display:flex;gap:14px;margin-right:220px;">
        ${steps
          .map(
            (s) => `
          <div style="flex:1;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:14px 12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04);">
            <div style="width:30px;height:30px;background:${NAVY};color:${GOLD};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;margin:0 auto 8px;">${s.num}</div>
            <div style="font-size:14px;font-weight:700;color:${NAVY};margin-bottom:4px;">${s.title}</div>
            <div style="font-size:11px;color:#475569;line-height:1.45;">${s.body}</div>
          </div>`,
          )
          .join("")}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;margin-right:220px;">
        <div style="display:flex;gap:14px;">
          <span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#334155;">✓ San Antonio Local</span>
          <span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#334155;">✓ As-Is Cash Offers</span>
          <span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#334155;">✓ No Obligation</span>
        </div>
        <div style="text-align:right;">
          <div style="font-size:17px;font-weight:700;color:${NAVY};">${PHONE}</div>
          <div style="font-size:11px;color:#64748B;">${WEBSITE}</div>
        </div>
      </div>
      <!-- Click2Mail address block: keep this region clear for USPS OCR. -->
      <div class="address-block" style="position:absolute;right:40px;bottom:26px;width:190px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#1E293B;text-align:left;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#64748B;margin-bottom:4px;">Mail To</div>
        <div style="font-weight:700;">{{name}}</div>
        <div>{{address}}</div>
        <div>{{city}}, {{state}} {{zip}}</div>
      </div>
    </div>`;
}

const STEPS_DEFAULT = [
  { num: "1", title: "Get Your Offer", body: "Call or visit our website. We'll assess your property and present a fair, no-obligation cash offer — usually within 24 hours." },
  { num: "2", title: "Accept &amp; Sign", body: "Like the offer? Sign the simple purchase agreement. No repairs, no showings, no agent commissions — we buy as-is." },
  { num: "3", title: "Close &amp; Get Paid", body: "Pick your closing date — as fast as 7 days or whenever works for you. You walk away with cash in hand." },
];

/** General / catch-all campaign. */
const GENERAL: PostcardTemplate = {
  id: "general",
  label: "General Cash Offer",
  front: frontPanel(
    "Cash Buyer",
    "{{address}}",
    "We Want to Buy Your House at",
    "{{address}}",
    "<strong style=\"color:" + GOLD + ";\">Fair cash offer in 24 hours.</strong> No repairs, no commissions, no hassle. Close on your timeline.",
    ["🔒 No Obligation", "💰 Cash Buyer", "⚡ Close in 7 Days"],
  ),
  back: backPanel(STEPS_DEFAULT),
};

/** Pre-foreclosure: urgency + timeline pressure. */
const PRE_FORECLOSURE: PostcardTemplate = {
  id: "pre-foreclosure",
  label: "Pre-Foreclosure",
  front: frontPanel(
    "Pre-Foreclosure Help",
    "{{address}}",
    "Facing Foreclosure?",
    "We Can Help You Sell Fast",
    "Avoid the auction. Sell your home quickly and <strong style=\"color:" + GOLD + ";\">walk away with cash</strong> — we handle everything, even if you're behind on payments.",
    ["⏰ Avoid Auction", "🔒 No Obligation", "⚡ Fast Close"],
  ),
  back: backPanel([
    { num: "1", title: "Get Your Offer", body: "Call us today. We'll make a fair cash offer on your property — no repairs required." },
    { num: "2", title: "Stop the Clock", body: "We work fast. Most sellers get an offer within 24 hours and can close before the sale date." },
    { num: "3", title: "Close &amp; Move On", body: "We coordinate with the lender and title company. You get cash and peace of mind." },
  ]),
};

/** Probate / inherited property: out-of-state or burdened owner. */
const PROBATE: PostcardTemplate = {
  id: "probate",
  label: "Probate / Inherited Property",
  front: frontPanel(
    "Inherited Property",
    "{{address}}",
    "Inherited a House You Don't Need?",
    "We Buy As-Is for Cash",
    "Tired of taxes, upkeep, and distance? <strong style=\"color:" + GOLD + ";\">Sell the inherited property fast</strong> — no repairs, no cleaning, no agent fees.",
    ["🏠 As-Is Purchase", "🔒 No Obligation", "⚡ Cash in Days"],
  ),
  back: backPanel([
    { num: "1", title: "Get Your Offer", body: "Tell us about the property. We'll present a fair cash offer, usually within 24 hours." },
    { num: "2", title: "Skip the Work", body: "We buy as-is. No repairs, no cleaning, no staging — we handle the paperwork." },
    { num: "3", title: "Close &amp; Get Paid", body: "Out-of-state? We make it easy. Close on your schedule and get cash in hand." },
  ]),
};

/** Tax delinquent: tax lien / sale pressure. */
const TAX_DELINQUENT: PostcardTemplate = {
  id: "tax-delinquent",
  label: "Tax Delinquent",
  front: frontPanel(
    "Tax Lien Relief",
    "{{address}}",
    "Behind on Property Taxes?",
    "We Pay Cash — Fast",
    "Protect your equity before the tax sale. <strong style=\"color:" + GOLD + ";\">Sell your house quickly for cash</strong> and settle what you owe.",
    ["🛡️ Before Tax Sale", "🔒 No Obligation", "⚡ Fast Close"],
  ),
  back: backPanel([
    { num: "1", title: "Get Your Offer", body: "Call today. We'll make a fair cash offer that covers your tax debt and puts money in your pocket." },
    { num: "2", title: "Settle the Lien", body: "We buy the property as-is and handle the payoff directly with the county." },
    { num: "3", title: "Close &amp; Move On", body: "Avoid the tax sale. Close quickly and walk away with cash instead of a lien." },
  ]),
};

export const POSTCARD_TEMPLATES: Record<PostcardCampaign, PostcardTemplate> = {
  general: GENERAL,
  "pre-foreclosure": PRE_FORECLOSURE,
  probate: PROBATE,
  "tax-delinquent": TAX_DELINQUENT,
};

export const POSTCARD_CAMPAIGNS = Object.keys(POSTCARD_TEMPLATES) as PostcardCampaign[];

/** Map a lead_source to the best-matching campaign. */
export function campaignForSource(source: string | null | undefined): PostcardCampaign {
  switch ((source || "").toLowerCase()) {
    case "pre-foreclosure":
    case "notice-of-default":
    case "substitute-trustee":
      return "pre-foreclosure";
    case "probate":
    case "inherited":
      return "probate";
    case "tax-delinquent":
    case "tax-lien":
    case "bcad":
      return "tax-delinquent";
    default:
      return "general";
  }
}

export interface PostcardMergeData {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** Business identity rendered into every postcard (PH1-B2). When fields are
 *  missing the placeholders stay visible — the identity guard in click2mail.ts
 *  blocks the send before any piece is printed, so a placeholder can never
 *  reach the mail. */
export interface PostcardIdentity {
  businessName: string;
  phone: string | null;
  website: string | null;
}

/** Substitute {{merge}} fields in a template fragment with escaped values, and
 *  render the business identity (phone/website/brand name) from the profile. */
export function renderPostcardTemplate(html: string, data: PostcardMergeData, identity?: PostcardIdentity): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const bizName = identity?.businessName?.trim() || "DealForge Properties";
  return html
    .replace(/\{\{name\}\}/g, esc(data.name))
    .replace(/\{\{address\}\}/g, esc(data.address))
    .replace(/\{\{city\}\}/g, esc(data.city))
    .replace(/\{\{state\}\}/g, esc(data.state))
    .replace(/\{\{zip\}\}/g, esc(data.zip))
    .replace(/\[PHONE\]/g, identity?.phone ? esc(identity.phone) : "[PHONE]")
    .replace(/\[WEBSITE\]/g, identity?.website ? esc(identity.website) : "[WEBSITE]")
    // Brand name in the header/footer ("Deal<span …>Forge</span> Properties") →
    // the profile business name, so no piece prints a name the owner did not set.
    .replace(/Deal<span[^>]*>Forge<\/span> Properties/g, esc(bizName));
}
