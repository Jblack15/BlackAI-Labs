// ─────────────────────────────────────────────────────────────────────────────
// DealFlow AI — Click2Mail direct-mail integration.
//
// Sends physical 6×9 postcards via Click2Mail's REST API
// (https://api.click2mail.com/v1) using their mail-merge model: one project
// (HTML template) per campaign, one mailpiece per recipient, all submitted as
// a single production job.
//
// Environment variables:
//   C2M_USERNAME   — Click2Mail account username (required)
//   C2M_API_KEY    — Click2Mail API key / passphrase (required)
//   C2M_PASSWORD   — fallback credential if C2M_API_KEY is not set
//   C2M_API_URL    — override API base URL (default https://api.click2mail.com/v1)
//
// When credentials are missing the module degrades gracefully: every attempt
// is logged to `mail_logs` as failed and the caller gets a clear error —
// mirrors the SMS/email integrations, so the CRM buttons work before the
// account is funded.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "~/db";
import {
  POSTCARD_TEMPLATES,
  renderPostcardTemplate,
  campaignForSource,
  type PostcardCampaign,
  type PostcardMergeData,
  type PostcardIdentity,
} from "~/lib/postcard-templates";

/** Estimated cost per 6×9 postcard (print + first-class postage). */
export const POSTCARD_COST_PER_PIECE = 0.6;

export interface PostcardLead extends PostcardMergeData {
  /** DealFlow lead id — used for mail_logs linkage. */
  id: string;
  /** Legacy suppression flag (dnc_flag text) — checked before any send. */
  suppression?: string | null;
  /** Full suppression flags (PH1-B2): do_not_mail and opted_out block mail;
   *  DNC / wrong-number / invalid are phone-centric and do NOT block mail. */
  do_not_mail?: boolean | null;
  opted_out?: boolean | null;
}

export type MailResult = {
  success: boolean;
  /** Pieces logged with status 'sent' (or submitted to Click2Mail). */
  sent: number;
  /** Pieces logged with status 'failed'. */
  failed: number;
  error?: string;
  /** Click2Mail job id when the job was created. */
  jobId?: string;
};

function isConfigured(): boolean {
  return !!(process.env.C2M_USERNAME && (process.env.C2M_API_KEY || process.env.C2M_PASSWORD));
}

export function isClick2MailConfigured(): boolean {
  return isConfigured();
}

// ── mail_logs ────────────────────────────────────────────────────────────────

async function logMail(opts: {
  leadId?: string;
  campaign?: string;
  template?: string;
  status: string;
  cost?: number;
  providerId?: string;
  error?: string;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO mail_logs (lead_id, campaign, template, status, sent_at, cost, provider_id, error)
      VALUES (
        ${opts.leadId || null},
        ${opts.campaign || null},
        ${opts.template || null},
        ${opts.status},
        now(),
        ${opts.cost ?? null},
        ${opts.providerId || null},
        ${opts.error || null}
      )
    `;
  } catch {
    // Never let logging failure break the caller
  }
}

// ── Click2Mail HTTP layer ────────────────────────────────────────────────────

const C2M_BASE_URL = "https://api.click2mail.com/v1";

function c2mAuthHeader(): string {
  const username = process.env.C2M_USERNAME || "";
  const password = process.env.C2M_API_KEY || process.env.C2M_PASSWORD || "";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

async function c2mRequest(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const base = process.env.C2M_API_URL || C2M_BASE_URL;
  const res = await fetch(`${base}${path}`, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: c2mAuthHeader(),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function pickId(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = data?.[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

// ── Template / project handling ──────────────────────────────────────────────

const projectIdCache = new Map<string, string>();

/**
 * Create (or reuse) a Click2Mail project for a campaign. A project holds the
 * postcard HTML — Click2Mail's mail-merge then personalizes each piece.
 * The exact payload below follows Click2Mail's REST API "projects" resource;
 * if the account's API variant differs, only this function needs adjusting.
 */
async function ensureProject(campaign: PostcardCampaign, identity: PostcardIdentity): Promise<{ projectId?: string; error?: string }> {
  const cached = projectIdCache.get(campaign);
  if (cached) return { projectId: cached };

  const template = POSTCARD_TEMPLATES[campaign];
  // Merge placeholders are substituted server-side per piece, so the project
  // template uses the placeholder values only as a design-time sample.
  const sample: PostcardMergeData = {
    name: "Sample Recipient",
    address: "123 Main Street",
    city: "San Antonio",
    state: "TX",
    zip: "78201",
  };

  const { ok, status, data } = await c2mRequest("/projects", {
    method: "POST",
    body: {
      project: {
        name: `DealFlow AI — ${template.label}`,
        description: "Auto-generated postcard template (DealFlow AI outreach)",
        designType: "postcard",
        paperSize: "6x9",
        layouts: [
          { layout: 1, type: "front", html: renderPostcardTemplate(template.front, sample, identity) },
          { layout: 2, type: "back", html: renderPostcardTemplate(template.back, sample, identity) },
        ],
      },
    },
  });

  if (!ok) {
    return { error: `Click2Mail project creation failed (HTTP ${status})` };
  }
  const projectId = pickId(data, "projectId", "id");
  if (!projectId) {
    return { error: "Click2Mail project creation returned no id" };
  }
  projectIdCache.set(campaign, projectId);
  return { projectId };
}

/** Submit mailpieces for one lead via a single production job. */
async function submitJob(
  campaign: PostcardCampaign,
  templateId: string | undefined,
  leads: PostcardLead[],
  identity: PostcardIdentity,
): Promise<{ jobId?: string; error?: string }> {
  // 1. Project (template)
  const { projectId, error: projectError } = await ensureProject(campaign, identity);
  if (projectError || !projectId) return { error: projectError || "No project id" };

  // 2. Mail pieces — one per recipient (mail merge)
  const mailpieces = leads.map((lead) => ({
    projectId,
    layout: 1,
    mailClass: "firstClass",
    addresses: [
      {
        name: lead.name,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
      },
    ],
    mergeData: { name: lead.name, address: lead.address, city: lead.city, state: lead.state, zip: lead.zip },
  }));

  const piecesRes = await c2mRequest("/mailpieces", { method: "POST", body: { mailpieces } });
  if (!piecesRes.ok) {
    return { error: `Click2Mail mailpiece creation failed (HTTP ${piecesRes.status})` };
  }
  const pieceIds = Array.isArray(piecesRes.data?.mailpieces)
    ? (piecesRes.data.mailpieces as { id?: string }[])
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  if (pieceIds.length === 0 && piecesRes.data?.mailpieceId) {
    pieceIds.push(String(piecesRes.data.mailpieceId));
  }
  if (pieceIds.length === 0) {
    return { error: "Click2Mail mailpiece creation returned no piece ids" };
  }

  // 3. Production job
  const jobRes = await c2mRequest("/jobs", {
    method: "POST",
    body: {
      job: {
        name: `DealFlow AI direct mail — ${campaign} (${leads.length} piece${leads.length === 1 ? "" : "s"})`,
        productionType: "print",
        mailClass: "firstClass",
        pieces: pieceIds.map((mailpieceId) => ({ mailpieceId })),
      },
    },
  });
  if (!jobRes.ok) {
    return { error: `Click2Mail job creation failed (HTTP ${jobRes.status})` };
  }
  const jobId = pickId(jobRes.data, "jobId", "id");
  if (!jobId) return { error: "Click2Mail job creation returned no id" };

  // 4. Submit for production
  const submitRes = await c2mRequest(`/jobs/${encodeURIComponent(jobId)}/submit`, { method: "POST" });
  if (!submitRes.ok) {
    return { error: `Click2Mail job submit failed (HTTP ${submitRes.status})`, jobId };
  }
  return { jobId };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send postcards to one or more leads via Click2Mail mail-merge.
 * Never throws — on any failure every piece is logged to mail_logs as failed
 * and the result carries a readable error.
 *
 * Compliance (PH1-B2): the identity guard requires business_name +
 * return_address before ANY piece is printed (nothing goes out in a name or
 * return address the owner did not set), and every piece — sent or blocked —
 * is written to outreach_audit_log.
 *
 * @param leads  Recipients (name + address). `id` is the DealFlow lead id.
 * @param opts.campaign  Postcard campaign; defaults to a per-lead mapping by
 *                       lead_source when opts.leadSources is provided.
 * @param opts.templateId  Optional pre-existing Click2Mail project id to reuse.
 */
export async function sendPostcards(
  leads: PostcardLead[],
  opts: { campaign?: PostcardCampaign; templateId?: string; leadSources?: Record<string, string | null> } = {},
): Promise<MailResult> {
  if (!leads.length) return { success: false, sent: 0, failed: 0, error: "No leads provided" };

  const { getBusinessProfile, assertBusinessIdentity, logOutreachAudit } = await import("~/lib/compliance");
  const profile = await getBusinessProfile();
  const identity: PostcardIdentity = {
    businessName: profile.business_name || "DealForge Properties",
    phone: profile.phone,
    website: profile.website,
  };

  // Identity guard — no mail without a configured business name + return address.
  const identityCheck = await assertBusinessIdentity("mail");
  if (!identityCheck.allowed) {
    for (const lead of leads) {
      await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "blocked", reason: identityCheck.reason, contactValue: lead.address });
    }
    return { success: false, sent: 0, failed: leads.length, error: identityCheck.reason };
  }

  // Hard block (PH1-B1 + B2): never mail a do-not-mail / opted-out lead. Per
  // the compliance matrix, DNC / wrong-number / invalid are phone-centric and
  // do NOT block mail. Suppressed pieces are logged to mail_logs + the audit
  // log as blocked with the reason so the trail is complete.
  const MAIL_BLOCK_FLAGS = new Set(["DO_NOT_MAIL", "OPTED_OUT"]);
  const mailAllowed: PostcardLead[] = [];
  let mailSuppressedCount = 0;
  for (const lead of leads) {
    const flag = lead.suppression?.trim().toUpperCase();
    const blocked = (flag && MAIL_BLOCK_FLAGS.has(flag)) || !!lead.do_not_mail || !!lead.opted_out;
    if (blocked) {
      mailSuppressedCount++;
      const campaign = opts.campaign || (opts.leadSources ? campaignForSource(opts.leadSources[lead.id]) : "general");
      const reason = `Blocked: contact is suppressed (do-not-mail / opted-out) — mail not permitted`;
      await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "blocked", reason, contactValue: lead.address });
      await logMail({
        leadId: lead.id,
        campaign,
        template: campaign,
        status: "failed",
        cost: POSTCARD_COST_PER_PIECE,
        error: `Suppressed (${flag || "flag"}) — mail blocked by compliance hard block`,
      });
    } else {
      mailAllowed.push(lead);
    }
  }
  if (!mailAllowed.length) {
    return { success: false, sent: 0, failed: mailSuppressedCount, error: "All leads are suppressed — nothing mailed" };
  }
  leads = mailAllowed;

  if (!isConfigured()) {
    const reason = "Click2Mail not configured — add C2M_USERNAME and C2M_API_KEY env vars";
    for (const lead of leads) {
      const campaign = opts.campaign || (opts.leadSources ? campaignForSource(opts.leadSources[lead.id]) : "general");
      await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "failed", reason, contactValue: lead.address });
      await logMail({
        leadId: lead.id,
        campaign,
        template: campaign,
        status: "failed",
        cost: POSTCARD_COST_PER_PIECE,
        error: reason,
      });
    }
    return {
      success: false,
      sent: 0,
      failed: leads.length,
      error: reason,
    };
  }

  try {
    // Group by campaign so each campaign becomes its own project + job.
    const byCampaign = new Map<PostcardCampaign, PostcardLead[]>();
    for (const lead of leads) {
      const campaign = opts.campaign || (opts.leadSources ? campaignForSource(opts.leadSources[lead.id]) : "general");
      const group = byCampaign.get(campaign) || [];
      group.push(lead);
      byCampaign.set(campaign, group);
    }

    let sent = 0;
    let failed = 0;
    let firstError: string | undefined;
    let lastJobId: string | undefined;

    for (const [campaign, group] of byCampaign) {
      const { jobId, error } = await submitJob(campaign, opts.templateId, group, identity);
      if (error) {
        firstError = firstError || error;
        failed += group.length;
        for (const lead of group) {
          await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "failed", reason: error, contactValue: lead.address });
          await logMail({
            leadId: lead.id,
            campaign,
            template: campaign,
            status: "failed",
            cost: POSTCARD_COST_PER_PIECE,
            error,
          });
        }
      } else {
        sent += group.length;
        lastJobId = jobId;
        for (const lead of group) {
          await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "sent", contactValue: lead.address });
          await logMail({
            leadId: lead.id,
            campaign,
            template: campaign,
            status: "sent",
            cost: POSTCARD_COST_PER_PIECE,
            providerId: jobId,
          });
        }
      }
    }

    return { success: failed === 0, sent, failed, error: firstError, jobId: lastJobId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown Click2Mail error";
    for (const lead of leads) {
      await logOutreachAudit({ leadId: lead.id, channel: "mail", direction: "outbound", status: "failed", reason: msg, contactValue: lead.address });
      await logMail({
        leadId: lead.id,
        campaign: opts.campaign || "general",
        template: opts.campaign || "general",
        status: "failed",
        cost: POSTCARD_COST_PER_PIECE,
        error: msg,
      });
    }
    return { success: false, sent: 0, failed: leads.length, error: msg };
  }
}

/**
 * Load leads from the database and send them postcards.
 * @param leadIds  Specific lead ids; empty means all non-closed leads with an address.
 * @param opts.campaign  Force one campaign for every piece (optional).
 */
export async function sendPostcardsToLeads(
  leadIds: string[],
  opts: { campaign?: PostcardCampaign } = {},
): Promise<MailResult> {
  const rows = (await sql`
    SELECT id, full_name, property_address, property_city, property_state, property_zip, lead_source, dnc_flag,
           do_not_mail, opted_out
    FROM leads
    WHERE status NOT IN ('closed_won', 'closed_lost')
      AND (${leadIds.length ? sql`id = ANY(${leadIds})` : sql`TRUE`})
      AND COALESCE(property_address, '') <> ''
      AND COALESCE(property_city, '') <> ''
      AND COALESCE(property_state, '') <> ''
      AND COALESCE(property_zip, '') <> ''
  `) as {
    id: string;
    full_name: string;
    property_address: string;
    property_city: string;
    property_state: string;
    property_zip: string;
    lead_source: string | null;
    dnc_flag: string | null;
    do_not_mail: boolean | null;
    opted_out: boolean | null;
  }[];

  if (!rows.length) return { success: false, sent: 0, failed: 0, error: "No leads with mailing addresses found" };

  const leads: PostcardLead[] = rows.map((r) => ({
    id: r.id,
    name: r.full_name || "Property Owner",
    address: r.property_address,
    city: r.property_city,
    state: r.property_state,
    zip: r.property_zip,
    suppression: r.dnc_flag,
    do_not_mail: r.do_not_mail,
    opted_out: r.opted_out,
  }));
  const leadSources: Record<string, string | null> = {};
  for (const r of rows) leadSources[r.id] = r.lead_source;

  return sendPostcards(leads, { campaign: opts.campaign, leadSources });
}

/** Simple cost estimate helper for the CRM confirm dialogs. */
export function estimateMailCost(pieceCount: number): number {
  return Math.round(pieceCount * POSTCARD_COST_PER_PIECE * 100) / 100;
}
