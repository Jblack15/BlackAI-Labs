// DealFlow AI — Compliance Core (PH1-B2)
//
// Extends the B1 hard block (lib/skip-trace.ts) into full suppression
// enforcement:
//   - outreach_audit_log: one row per outbound attempt (sent / attempted /
//     blocked / failed) and per inbound event (opt-out, received) — the audit
//     trail is written by the send paths themselves, so a blocked send is just
//     as visible as a delivered one.
//   - consent_records: explicit consent / opt-out events (granted=true|false).
//   - handleOptOut / recordSuppression: the human-in-the-loop surface — CRM
//     buttons call these; a future inbound SMS/email hook calls handleOptOut
//     the same way.
//   - business_profile: the identity every outbound template renders. The
//     identity guard refuses ALL outbound sends until the fields a channel
//     needs are filled — nothing ever goes out in a name the owner did not set
//     (closes the "Joshua Black default" class of problem in-app).
//   - getComplianceSummary: honest per-channel status + suppression counts for
//     the settings-page compliance panel.
//
// NOT CONNECTED things are labeled NOT CONNECTED, never claimed as live.
import { sql } from "~/db";
import type { OutreachChannel, OutreachCheckResult } from "~/lib/skip-trace";

// --- Audit log --------------------------------------------------------------

export type OutreachAuditStatus = "sent" | "attempted" | "blocked" | "failed" | "received";

export type OutreachAuditInput = {
  leadId?: string | null;
  channel: OutreachChannel;
  direction: "outbound" | "inbound";
  status: OutreachAuditStatus;
  reason?: string | null;
  contactValue?: string | null;
  contentPreview?: string | null;
  operator?: string | null;
};

const CONTENT_PREVIEW_MAX = 200;

/** Truncate a message preview for the audit log (never store full bodies). */
export function truncatePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > CONTENT_PREVIEW_MAX ? `${t.slice(0, CONTENT_PREVIEW_MAX)}…` : t;
}

/**
 * Write one outreach audit row. Never throws — logging must not break a send
 * path (the send itself is the important part; a logging failure is swallowed
 * and the caller carries on).
 */
export async function logOutreachAudit(opts: OutreachAuditInput): Promise<void> {
  try {
    await sql`
      INSERT INTO outreach_audit_log (lead_id, channel, direction, status, reason, contact_value, content_preview, operator)
      VALUES (
        ${opts.leadId || null},
        ${opts.channel},
        ${opts.direction},
        ${opts.status},
        ${opts.reason || null},
        ${opts.contactValue || null},
        ${truncatePreview(opts.contentPreview)},
        ${opts.operator || null}
      )
    `;
  } catch {
    // Never let logging failure break the caller
  }
}

// --- Suppression actions (human-in-the-loop) --------------------------------

export type SuppressionFlag = "do_not_mail" | "opted_out" | "invalid_contact" | "wrong_number";

const SUPPRESSION_REASONS: Record<SuppressionFlag, string> = {
  do_not_mail: "do-not-mail",
  opted_out: "opted out",
  invalid_contact: "invalid contact",
  wrong_number: "wrong number",
};

/**
 * Record a suppression flag for a lead (the CRM "Mark opted out / wrong
 * number / invalid / do-not-mail" buttons). Sets the flag, writes an audit row
 * (direction=inbound, status=blocked so it reads as "this lead must not be
 * contacted", reason=flag, operator=who did it) and, for opted_out, also
 * writes the consent record (granted=false) + consent timestamps.
 */
export async function recordSuppression(
  leadId: string,
  flag: SuppressionFlag,
  opts: { operator?: string; channel?: OutreachChannel; detail?: string; source?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const channel = opts.channel ?? "manual";
    const source = opts.source ?? "manual";
    const reason = `Blocked: contact ${SUPPRESSION_REASONS[flag]} — outreach not permitted`;
    if (flag === "opted_out") {
      await sql`
        UPDATE leads
        SET opted_out = true, consent_recorded_at = now(), consent_source = ${source}
        WHERE id = ${leadId}
      `;
      await sql`
        INSERT INTO consent_records (lead_id, channel, granted, source, detail)
        VALUES (${leadId}, ${channel}, false, ${source}, ${opts.detail || "Opt-out recorded manually in CRM"})
      `;
    } else if (flag === "do_not_mail") {
      await sql`UPDATE leads SET do_not_mail = true WHERE id = ${leadId}`;
    } else if (flag === "invalid_contact") {
      await sql`UPDATE leads SET invalid_contact = true WHERE id = ${leadId}`;
    } else {
      await sql`UPDATE leads SET wrong_number = true WHERE id = ${leadId}`;
    }
    await logOutreachAudit({
      leadId,
      channel,
      direction: "inbound",
      status: "blocked",
      reason,
      operator: opts.operator || "crm-user",
      contentPreview: opts.detail || null,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to record suppression" };
  }
}

/**
 * Inbound STOP / opt-out handler. Sets opted_out=true with consent timestamps,
 * writes the consent record (granted=false) and an inbound audit row. Wire an
 * inbound SMS/email hook here when a provider is connected — the CRM button
 * path already calls this via recordSuppression("opted_out").
 */
export async function handleOptOut(
  leadIdOrContact: string,
  channel: OutreachChannel,
  opts: { source?: string; operator?: string; detail?: string } = {},
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  try {
    // Resolve lead by id (uuid) or by an exact phone/email match. Only
    // compare `id` when the value is actually a uuid — Postgres rejects
    // `id = 'phone'` with an invalid-uuid cast error.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadIdOrContact);
    const rows = (isUuid
      ? await sql`
          SELECT id FROM leads
          WHERE id = ${leadIdOrContact} OR phone = ${leadIdOrContact} OR email = ${leadIdOrContact}
          LIMIT 1
        `
      : await sql`
          SELECT id FROM leads
          WHERE phone = ${leadIdOrContact} OR email = ${leadIdOrContact}
          LIMIT 1
        `) as { id: string }[];
    if (!rows.length) {
      return { success: false, error: "Lead not found for opt-out — record suppression manually in CRM" };
    }
    const leadId = rows[0].id;
    const source = opts.source || "sms-reply";
    await sql`
      UPDATE leads
      SET opted_out = true, consent_recorded_at = now(), consent_source = ${source}
      WHERE id = ${leadId}
    `;
    await sql`
      INSERT INTO consent_records (lead_id, channel, granted, source, detail)
      VALUES (${leadId}, ${channel}, false, ${source}, ${opts.detail || "STOP / opt-out received"})
    `;
    await logOutreachAudit({
      leadId,
      channel,
      direction: "inbound",
      status: "received",
      reason: "Opt-out received (STOP)",
      contactValue: leadIdOrContact,
      contentPreview: opts.detail || null,
      operator: opts.operator || null,
    });
    return { success: true, leadId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to process opt-out" };
  }
}

// --- Business identity profile ----------------------------------------------

export type BusinessProfile = {
  business_name: string;
  contact_name: string | null;
  phone: string | null;
  website: string | null;
  return_address: string | null;
  email: string | null;
  updated_at: string;
};

const DEFAULT_PROFILE: BusinessProfile = {
  business_name: "DealForge Properties",
  contact_name: null,
  phone: null,
  website: null,
  return_address: null,
  email: null,
  updated_at: "",
};

/** Load the business identity profile (single-row table, id=1). */
export async function getBusinessProfile(): Promise<BusinessProfile> {
  try {
    const rows = (await sql`
      SELECT business_name, contact_name, phone, website, return_address, email, updated_at
      FROM business_profile WHERE id = 1
    `) as BusinessProfile[];
    if (!rows.length) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...rows[0], updated_at: String(rows[0].updated_at) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

/**
 * Validate the settable identity fields before persisting (PH1 identity
 * wiring): email must be a well-formed address (or empty), phone a non-empty
 * string, website a URL or empty (bare domains like dealforgeproperties.com are
 * accepted — the templates render them as-is). Returns {valid:false, error}
 * with a human reason when a field fails; never throws.
 */
export function validateBusinessProfile(fields: {
  business_name?: string;
  contact_name?: string | null;
  phone?: string | null;
  website?: string | null;
  return_address?: string | null;
  email?: string | null;
}): { valid: boolean; error?: string } {
  if (!fields.business_name?.trim()) return { valid: false, error: "Business name is required" };
  if (!fields.phone?.trim()) return { valid: false, error: "Phone is required (non-empty string)" };
  const email = fields.email?.trim() || "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: `Email format is invalid: ${email}` };
  }
  const website = fields.website?.trim() || "";
  if (website) {
    const candidate = website.includes("://") ? website : `https://${website}`;
    try {
      const u = new URL(candidate);
      if (!u.hostname || !u.hostname.includes(".")) {
        return { valid: false, error: `Website URL is invalid: ${website}` };
      }
    } catch {
      return { valid: false, error: `Website URL is invalid: ${website}` };
    }
  }
  return { valid: true };
}

/** Persist the identity profile (only the fields the owner can fill). Every
 *  successful update is written to the outreach audit trail (channel
 *  'settings_identity', direction 'outbound', status 'sent') so identity
 *  changes are never silent — the settings panel audit log shows who changed
 *  the business identity and when. */
export async function saveBusinessProfile(
  fields: Partial<Pick<BusinessProfile, "business_name" | "contact_name" | "phone" | "website" | "return_address" | "email">>,
): Promise<{ success: boolean; profile: BusinessProfile; error?: string }> {
  try {
    const check = validateBusinessProfile(fields);
    if (!check.valid) {
      return { success: false, profile: await getBusinessProfile(), error: check.error };
    }
    const next = { ...(await getBusinessProfile()), ...fields };
    await sql`
      INSERT INTO business_profile (id, business_name, contact_name, phone, website, return_address, email, updated_at)
      VALUES (1, ${next.business_name || "DealForge Properties"}, ${next.contact_name || null}, ${next.phone || null}, ${next.website || null}, ${next.return_address || null}, ${next.email || null}, now())
      ON CONFLICT (id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        return_address = EXCLUDED.return_address,
        email = EXCLUDED.email,
        updated_at = now()
    `;
    const profile = await getBusinessProfile();
    await logOutreachAudit({
      channel: "settings_identity" as unknown as OutreachChannel,
      direction: "outbound",
      status: "sent",
      reason: "Business identity updated from Settings",
      contentPreview: `${profile.contact_name || ""} · ${profile.business_name} · ${profile.phone || ""}`,
      operator: "owner",
    });
    return { success: true, profile };
  } catch (err) {
    return { success: false, profile: await getBusinessProfile(), error: err instanceof Error ? err.message : "Failed to save profile" };
  }
}

/**
 * Identity guard — the fields a channel needs must be filled before any
 * outbound send. Business name is required for every channel; website for
 * email (email links must point at the real site); return address for mail;
 * phone for voice/SMS. Empty profile → blocked with
 * "business identity not configured (…)" — the owner must fill settings.
 */
export async function assertBusinessIdentity(channel: OutreachChannel): Promise<OutreachCheckResult> {
  const profile = await getBusinessProfile();
  const missing: string[] = [];
  if (!profile.business_name?.trim()) missing.push("business_name");
  if (channel === "email" && !profile.website?.trim()) missing.push("website");
  if (channel === "mail" && !profile.return_address?.trim()) missing.push("return_address");
  if ((channel === "sms" || channel === "voice") && !profile.phone?.trim()) missing.push("phone");
  if (missing.length) {
    return {
      allowed: false,
      reason: `Blocked: business identity not configured (${missing.join(", ")} empty) — fill business identity in Settings before any outbound ${channel} send`,
    };
  }
  return { allowed: true };
}

// --- Compliance summary (settings panel) ------------------------------------

export type ComplianceSummary = {
  channels: {
    email: { status: "NOT CONNECTED"; detail: string };
    sms: { status: "NOT CONNECTED"; detail: string };
    mail: { status: string; detail: string };
    voice: { status: string; detail: string };
  };
  suppression: {
    dnc: number;
    do_not_mail: number;
    opted_out: number;
    invalid_contact: number;
    wrong_number: number;
    consent_recorded: number;
  };
  audit_log_rows: number;
  identity: BusinessProfile;
  identityComplete: { business_name: boolean; contact_name: boolean; website: boolean; return_address: boolean; phone: boolean; email: boolean };
};

/**
 * Live summary for the settings compliance panel. Channel statuses are honest:
 * email shows NOT CONNECTED until SMTP env vars exist, SMS is NOT CONNECTED
 * (channel discontinued 2026-08-12), mail/voice are external (PropStream
 * Campaigns / BatchDialer) and only report pilot status — never "configured"
 * when nothing has been sent.
 */
export async function getComplianceSummary(): Promise<ComplianceSummary> {
  const safeCount = async (query: () => Promise<unknown>): Promise<number> => {
    try {
      const rows = (await query()) as { n: number }[];
      return rows[0]?.n ?? 0;
    } catch {
      return 0;
    }
  };
  const [dnc, doNotMail, optedOut, invalidContact, wrongNumber, consentRecorded, auditRows, identity] =
    await Promise.all([
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE COALESCE(dnc_flag, '') <> ''`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE do_not_mail = true`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE opted_out = true`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE invalid_contact = true`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE wrong_number = true`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM leads WHERE consent_recorded_at IS NOT NULL`),
      safeCount(() => sql`SELECT count(*)::int AS n FROM outreach_audit_log`),
      getBusinessProfile(),
    ]);
  return {
    channels: {
      email: {
        status: "NOT CONNECTED",
        detail:
          process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
            ? "SMTP env vars present — no outbound email has been sent"
            : "no SMTP configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing)",
      },
      sms: { status: "NOT CONNECTED", detail: "channel discontinued 2026-08-12 (owner decision) — sends disabled platform-wide" },
      mail: {
        status: "EXTERNAL — PILOT STAGED",
        detail: "direct mail runs via PropStream Campaigns / Ballpoint (external) — pilot at Order Summary 2026-08-12, NOTHING SENT; Click2Mail integration in-app is not the active channel",
      },
      voice: {
        status: "EXTERNAL — PENDING",
        detail: "voice runs via BatchDialer (external, free 7-day trial pending owner signup) — in-app voice sends are not implemented",
      },
    },
    suppression: {
      dnc,
      do_not_mail: doNotMail,
      opted_out: optedOut,
      invalid_contact: invalidContact,
      wrong_number: wrongNumber,
      consent_recorded: consentRecorded,
    },
    audit_log_rows: auditRows,
    identity,
    identityComplete: {
      business_name: !!identity.business_name?.trim(),
      contact_name: !!identity.contact_name?.trim(),
      website: !!identity.website?.trim(),
      return_address: !!identity.return_address?.trim(),
      phone: !!identity.phone?.trim(),
      email: !!identity.email?.trim(),
    },
  };
}

/** Recent audit rows for the settings panel (no full message bodies). */
export async function listRecentAuditLog(limit = 15): Promise<
  Array<{ id: number; lead_id: string | null; channel: string; direction: string; status: string; reason: string | null; contact_value: string | null; content_preview: string | null; operator: string | null; created_at: string }>
> {
  try {
    const rows = await sql`
      SELECT id, lead_id, channel, direction, status, reason, contact_value, content_preview, operator, created_at
      FROM outreach_audit_log
      ORDER BY id DESC
      LIMIT ${limit}
    ` as Array<{
      id: number; lead_id: string | null; channel: string; direction: string; status: string;
      reason: string | null; contact_value: string | null; content_preview: string | null;
      operator: string | null; created_at: string;
    }>;
    return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
  } catch {
    return [];
  }
}
