import { sql } from "~/db";
import { sendSms } from "~/lib/sms";
import { assertOutreachAllowed } from "~/lib/skip-trace";
import { logOutreachAudit } from "~/lib/compliance";

// SMS drip templates. The business name is rendered from the business_profile
// at send time (the third template arg) — nothing hardcodes an identity that
// the owner did not set.
export const SMS_SEQUENCE = [
  (name: string, address: string, businessName: string) =>
    `Hi ${name}, this is ${businessName}. We’re reaching out about ${address}. Would you be open to a quick conversation about a cash offer? Reply STOP to opt out.`,
  (name: string, address: string, businessName: string) =>
    `Hi ${name}, just following up about ${address}. If selling is on your mind, ${businessName} can provide a no-obligation cash offer. Reply STOP to opt out.`,
  (name: string, address: string, businessName: string) =>
    `Hi ${name}, this is our last follow-up about ${address}. If now isn’t the right time, no problem — you won't hear from ${businessName} again about this property. Reply STOP to opt out.`,
];

async function getBusinessName(): Promise<string> {
  try {
    const { getBusinessProfile } = await import("~/lib/compliance");
    const profile = await getBusinessProfile();
    return profile.business_name || "DealForge Properties";
  } catch {
    return "DealForge Properties";
  }
}

export async function startSmsOutreach(leadId: string) {
  const rows = (await sql`
    SELECT full_name, phone, property_address, property_city, property_state, dnc_flag
    FROM leads WHERE id = ${leadId}
  `) as {
    full_name: string;
    phone: string | null;
    property_address: string;
    property_city: string;
    property_state: string;
    dnc_flag: string | null;
  }[];
  const lead = rows[0];
  if (!lead) return { success: false, error: "Lead not found" };
  // Hard block (PH1-B1 + B2): no phone or suppressed (dnc/opted-out/invalid/
  // wrong-number) → refuse to start the drip, and audit the block.
  const check = assertOutreachAllowed({ phone: lead.phone, email: null, dnc_flag: lead.dnc_flag }, "sms");
  if (!check.allowed) {
    await logOutreachAudit({ leadId, channel: "sms", direction: "outbound", status: "blocked", reason: check.reason, contactValue: lead.phone });
    return { success: false, error: check.reason };
  }
  if (!lead.phone) return { success: false, error: "Lead has no phone number" };
  const address = `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`;
  const businessName = await getBusinessName();
  // Outreach status spine (PH1-B6): sendSms bumps the lead to contact_attempted
  // on a real transmission — no status handling needed here.
  const result = await sendSms(lead.phone, SMS_SEQUENCE[0](lead.full_name, address, businessName), leadId);
  if (!result.success) return result;
  for (const [step, days] of [[2, 2], [3, 7]] as const)
    await sql`
      INSERT INTO outreach_sequences(lead_id, channel, step, status, scheduled_for)
      VALUES(${leadId}, 'sms', ${step}, 'scheduled', now() + (${days} * interval '1 day'))
      ON CONFLICT DO NOTHING
    `;
  return { success: true, sid: result.sid };
}
export async function startBulkOutreach() {
  const rows = await sql`
    SELECT id FROM leads
    WHERE status = 'qualified' AND phone IS NOT NULL AND phone <> '' AND contactable = true
  `;
  let started = 0;
  for (const row of rows as { id: string }[]) {
    const r = await startSmsOutreach(row.id);
    if (r.success) started++;
  }
  return { success: true, started };
}
