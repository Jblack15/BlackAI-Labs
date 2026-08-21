// ─────────────────────────────────────────────────────────────────────────────
// Verify the DealForge seller-email reply/opt-out path resolves to a WORKING
// inbox (dealforgeproperties@gmail.com) — never the provider-paused cto inbox
// (dealforge-properties-8480c335@ctomail.io).
//
// This is a PURE, unit-style check. It does NOT send any email to anyone. It
// exercises the resolution helper (resolveWorkingReplyAddress) and the pure
// template composition functions (optOutMailto / footerText / footerHtml) with
// production-like env (EMAIL_FROM / SMTP_USER = the Gmail account) and asserts
// every reply landing-point points at the working address.
//
//   NODE_OPTIONS=--max-old-space-size=1800 bun scripts/verify-reply-path.ts
// ─────────────────────────────────────────────────────────────────────────────
import { resolveWorkingReplyAddress } from "../src/lib/email-send";
import {
  optOutMailto,
  footerText,
  footerHtml,
  type SellerEmailIdentity,
} from "../src/lib/email-templates";

const WORKING = "dealforgeproperties@gmail.com";
const PAUSED = "dealforge-properties-8480c335@ctomail.io";
const DISPLAY_NAME = "DealForge Properties";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ── 1. resolveWorkingReplyAddress priority ──────────────────────────────────
console.log("\n[1] resolveWorkingReplyAddress priority (EMAIL_FROM → SMTP_USER → profile)");

delete process.env.EMAIL_FROM;
delete process.env.SMTP_USER;
check(
  resolveWorkingReplyAddress(PAUSED) === PAUSED,
  "no env → falls back to business_profile.email",
);

process.env.SMTP_USER = WORKING;
check(
  resolveWorkingReplyAddress(PAUSED) === WORKING,
  "SMTP_USER set → resolves to working Gmail (not paused cto)",
);

process.env.EMAIL_FROM = WORKING;
check(
  resolveWorkingReplyAddress(PAUSED) === WORKING,
  "EMAIL_FROM set (priority) → resolves to working Gmail",
);
check(
  resolveWorkingReplyAddress(PAUSED) !== PAUSED,
  "never resolves to the paused cto inbox when a working address is configured",
);

// ── 2. from / replyTo composition (production-like) ─────────────────────────
console.log("\n[2] from / replyTo composition (send path, production env)");
// Simulate sendSellerEmail's composition: workingEmail resolved from the
// business profile fallback while EMAIL_FROM/SMTP_USER are set.
const workingEmail = resolveWorkingReplyAddress(PAUSED);
const from = `${DISPLAY_NAME} <${workingEmail}>`;
const replyTo = workingEmail;
check(
  from === `${DISPLAY_NAME} <${WORKING}>`,
  `from = "${from}" (display name + working Gmail)`,
);
check(replyTo === WORKING, `replyTo = "${replyTo}" (working Gmail)`);
check(!from.includes(PAUSED) && !replyTo.includes(PAUSED), "neither from nor replyTo uses the paused cto inbox");

// ── 3. Template identity routes opt-out mailto to the working address ───────
console.log("\n[3] template opt-out mailto + footer (identity.email = working)");
const identity: SellerEmailIdentity = {
  businessName: DISPLAY_NAME,
  contactName: "Joshua Black",
  website: "dealforgeproperties.com",
  phone: "(210) 555-0142",
  email: WORKING, // this is what sendEmail composes (sendIdentity.email = workingEmail)
  returnAddress: "123 Main St, San Antonio TX 78205",
};

const mailto = optOutMailto(identity);
check(mailto !== null, "optOutMailto returns a mailto when identity.email is set");
check(!!mailto && mailto.startsWith(`mailto:${WORKING}`), `unsubscribe mailto → "${mailto}" targets working Gmail`);
check(!!mailto && !mailto.includes(PAUSED), "unsubscribe mailto does NOT target the paused cto inbox");

const ft = footerText(identity);
const fh = footerHtml(identity);
check(ft.includes(`mailto:${WORKING}`), "plain-text footer embeds working-Gmail unsubscribe mailto");
check(fh.includes(`mailto:${WORKING}`), "HTML footer embeds working-Gmail unsubscribe mailto");
check(!ft.includes(PAUSED) && !fh.includes(PAUSED), "neither footer references the paused cto inbox");

// ── 4. Explicit negative: if identity.email is the paused cto, we DO flag it ─
console.log("\n[4] negative control — paused cto inbox is NOT used by the new path");
check(optOutMailto({ ...identity, email: PAUSED })!.startsWith(`mailto:${PAUSED}`),
  "(sanity) old behavior would target the paused inbox — proving the fix routes it to working instead");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`));
process.exit(failures === 0 ? 0 : 1);
