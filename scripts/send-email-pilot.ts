// DealForge Properties — FIRE the approved Email Pilot (Option A): 13 sends.
//
// Owner approved campaign "Email Pilot Top-25 2026-08" (channel_campaign
// approval 5818d515, status=approved, decided_by=owner 2026-08-21T20:54Z).
// This drives every email through the REAL audited sendSellerEmail() pipeline
// (lib/email-send.ts) so each send is gate-checked at runtime (provider →
// campaign-approval → per-lead compliance), transmitted via the configured
// Gmail SMTP, logged to email_logs + outreach_audit_log, stamps last_contact_at
// and schedules the follow-up drip.
//
// 13 recipients = the approved scope: 2 trustees + 11 test from the Top-25.
// Each lead id below resolved to a clean, email-compliant lead row (verified).
//
// Run:  SMTP_HOST=smtp.gmail.com bun scripts/send-email-pilot.ts   (from site/)
// Requires SMTP_USER, SMTP_PASS, DATABASE_URL in the environment.
import { sendSellerEmail, loadSellerLead } from "../src/lib/email-send";

const CAMPAIGN_ID = "55166f5f-353f-4f69-837d-a2007e8b6be4"; // Email Pilot Top-25 2026-08
const TEMPLATE = "initial";

// 13 approved recipients (rank -> name -> lead id), trustees last.
const LEAD_IDS: { name: string; id: string }[] = [
  { name: "Odilo Molina", id: "db865a2a-6c60-4ae7-a883-e41d1f7f2c63" },
  { name: "Ricardo Garcia", id: "15a15e18-344b-4a3b-af8c-f9203d938063" },
  { name: "Kenneth Schneider", id: "01768adc-c9b0-4ae8-872b-f63b5dd99c3c" },
  { name: "Juan Castillo", id: "e68277ce-cefb-471a-b3a9-e77b9c36b1a4" },
  { name: "Lucy Ratcliff", id: "650dcc79-ec78-441a-8b22-343d52abaa12" },
  { name: "Justo Tijerina", id: "f79ac7a1-15b7-4a7e-bb96-e20ff18d25c1" },
  { name: "Eloy Rosales", id: "4d23ba91-6e29-436f-9a2a-6a64010c5698" },
  { name: "Jose Lozano", id: "cc1dc913-e798-40d3-8060-ad3cd64a1a8e" },
  { name: "Frank Cortez", id: "78173dbd-6378-4290-b8a2-b03482767cc6" },
  { name: "Cynthia Beltran", id: "e50eb7db-947b-4e40-9dca-1fe8aaeb5def" },
  { name: "Clara Casso", id: "6bb2b6e8-a8ba-4bc2-8fb8-2c8b3ce7160b" },
  { name: "Tina Grau Living Trust", id: "f4c0226c-89d9-4442-bb9d-81a2dcd749c0" },
  { name: "Johnny And Rosalie Gabriel Revocable Trust", id: "1b032099-18e0-403f-801d-f802698ff9f2" },
];

async function main() {
  let sent = 0, failed = 0;
  for (const r of LEAD_IDS) {
    const lead = await loadSellerLead(r.id);
    if (!lead) { console.log(`SKIP ${r.name} — lead not found`); continue; }
    if (!lead.email) { console.log(`SKIP ${r.name} — no email on file`); continue; }
    try {
      const res = await sendSellerEmail(lead, { campaignId: CAMPAIGN_ID, template: TEMPLATE });
      if (res.success) { console.log(`SENT ${r.name} <${lead.email}> (${res.messageId})`); sent++; }
      else { console.log(`FAIL ${r.name} <${lead.email}> — ${res.error}`); failed++; }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`BLOCKED ${r.name} <${lead.email}> — ${msg}`); failed++;
    }
  }
  console.log(`\nDONE — sent=${sent} failed/blocked=${failed} of ${LEAD_IDS.length}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
