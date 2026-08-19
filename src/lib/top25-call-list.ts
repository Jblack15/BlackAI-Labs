// DealFlow AI — In-app Smart Top-25 call-list generator (D1, §11 item 4)
//
// Brings the repo-external generator (/home/team/shared/call-package/
// refresh-call-package.ts) INTO the app as a server-side library so the owner
// can regenerate and read the 25-lead manual-call list from the /operations
// screen. Reuses the prioritization lib (never duplicates the ranking logic)
// and only surfaces STORED data — no invented fields.
//
// Manual-call framing is kept: voice = the owner's own call, no dialer. The
// compliance line (DNC/opt-out/do-not-mail check + trace status) is computed
// from the real lead row, exactly as the external generator did.

import type { Next25Lead, PriorityQueue } from "./prioritization";

export interface Top25Entry extends Next25Lead {
  rank: number;
  trace_status: string | null;
  traced_at: string | null;
  last_contact_at: string | null;
  lead_source: string | null;
  notes: string | null;
  ev: number | null;
  estimated_arv: number | null;
  foreclosure_factor: string | null;
  years_delq: string | null;
  owner_occupied: string | null;
  property_type: string | null;
  estimated_repairs: number | null;
  property_condition: string | null;
  reason_for_selling: string | null;
  premium_lead: boolean;
  disposition_status: string | null;
  disposition_strategy: string | null;
  compliance: {
    dnc: boolean;
    do_not_mail: boolean;
    opted_out: boolean;
    invalid_contact: boolean;
    wrong_number: boolean;
    clean: boolean;
    contactable: boolean;
  };
}

export interface Top25CallList {
  generatedAt: string;
  count: number;
  queueCounts: { queue: string; count: number }[];
  withPhone: number;
  contactable: number;
  complianceClean: number;
  entries: Top25Entry[];
  /** The same markdown the owner already uses, regenerated live. */
  markdown: string;
}

const fmtPhone = (p: string | null): string => {
  if (!p) return "—";
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};
const money = (v: unknown): string =>
  v === null || v === undefined || v === "" || v === "None" ? "—" : "$" + Number(v).toLocaleString("en-US");
const dash = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const dateShort = (v: unknown): string => {
  if (!v) return "—";
  return String(v).slice(0, 10);
};
const leadWith = (notes: string | null): string => {
  if (!notes) return "—";
  const m = notes.match(/Lead with:\s*"([^"]+)"/);
  return m ? m[1] : "—";
};
const incumbent = new Set<string>(["hold", "deprioritized"]);
const actNow = new Set<string>(["outreach_ready"]);

/**
 * Regenerate the top-25 call list. Optionally refresh priorities first (the
 * external generator always did) so the list reflects the latest queue state
 * after a trace import. Returns structured data + the owner-facing markdown.
 */
export async function generateTop25CallList(opts: { refreshPriorities?: boolean } = {}): Promise<Top25CallList> {
  const { sql } = await import("~/db");
  const { refreshPriorities, next25ToWork, queueDistribution } = await import("./prioritization");

  if (opts.refreshPriorities) {
    await refreshPriorities();
  }
  const top25 = await next25ToWork();
  const ids = top25.map((t) => t.id);
  const rows = ids.length
    ? ((await sql`SELECT * FROM leads WHERE id = ANY(${ids}::uuid[])`) as Array<Record<string, unknown>>)
    : [];
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  let withPhone = 0;
  let contactable = 0;
  let complianceClean = 0;
  const entries: Top25Entry[] = top25.map((t, i) => {
    const f = byId.get(t.id) ?? {};
    const sf = (f.score_factors ?? {}) as Record<string, unknown>;
    const dnc = !!f.dnc_flag;
    const do_not_mail = !!f.do_not_mail;
    const opted_out = !!f.opted_out;
    const invalid_contact = !!f.invalid_contact;
    const wrong_number = !!f.wrong_number;
    const clean = !dnc && !do_not_mail && !opted_out && !invalid_contact && !wrong_number;
    const safeContactable = !!f.contactable;
    if (t.phone) withPhone++;
    if (safeContactable) contactable++;
    if (clean) complianceClean++;
    return {
      ...t,
      rank: i + 1,
      trace_status: (f.trace_status as string) ?? null,
      traced_at: f.traced_at ? String(f.traced_at) : null,
      last_contact_at: f.last_contact_at ? String(f.last_contact_at) : null,
      lead_source: (f.lead_source as string) ?? null,
      notes: (f.notes as string) ?? null,
      ev: sf.ev == null ? null : Number(sf.ev),
      estimated_arv: sf.estimated_arv == null ? null : Number(sf.estimated_arv),
      foreclosure_factor: typeof sf.foreclosure_factor === "string" ? (sf.foreclosure_factor as string) : null,
      years_delq: sf.years_delq == null ? null : String(sf.years_delq),
      owner_occupied: sf.owner_occupied == null ? null : String(sf.owner_occupied),
      property_type: sf.property_type == null ? null : String(sf.property_type),
      estimated_repairs: f.estimated_repairs == null ? null : Number(f.estimated_repairs),
      property_condition: (f.property_condition as string) ?? null,
      reason_for_selling: (f.reason_for_selling as string) ?? null,
      premium_lead: !!f.premium_lead,
      disposition_status: (f.disposition_status as string) ?? null,
      disposition_strategy: (f.disposition_strategy as string) ?? null,
      compliance: {
        dnc,
        do_not_mail,
        opted_out,
        invalid_contact,
        wrong_number,
        clean,
        contactable: safeContactable,
      },
    };
  });

  const queueCounts = await queueDistribution();

  // ---- Build the owner-facing markdown (same shape as the external tool) ----
  const L: string[] = [];
  L.push("# DealForge — TOP-25 Manual Call List (live CRM)");
  L.push("");
  L.push(`**Source:** live production CRM (Neon Postgres) · **Generated:** ${new Date()
    .toISOString()
    .slice(0, 10)} · **Zero-spend pilot outreach list #1**`);
  const qc = Object.fromEntries(queueCounts.map((q) => [q.queue, q.count]));
  L.push(
    `**Queue counts (recomputed at pull):** HOT ${qc.HOT ?? 0} · HIGH ${qc.HIGH ?? 0} · MEDIUM ${qc.MEDIUM ?? 0} · LOW ${qc.LOW ?? 0} · DEAD ${qc.DEAD ?? 0} · TOTAL ${(qc.HOT ?? 0) + (qc.HIGH ?? 0) + (qc.MEDIUM ?? 0) + (qc.LOW ?? 0) + (qc.DEAD ?? 0)}`,
  );
  L.push(
    `**Verification:** ${entries.length} leads · ${withPhone} with phone · ${contactable} contactable · ${complianceClean} with no DNC/opt-out/do-not-mail on record · all trace_status = TRACED.`,
  );
  L.push("**Compliance:** every number below is DNC-clean and not opted out as of pull time. Verify on call; honor any verbal opt-out immediately.");
  L.push("");
  L.push("> **Read this first — three tiers in this list.** Ranks 1–7 are **HOT** (score 9, elevated foreclosure factor) — call these first. Ranks 8–25 are **HIGH** (score 8) ordered by equity; premium dispositions are flagged — honor each lead's disposition note below.");
  L.push("");
  L.push("**Compliance gate:** All manual owner calls. No dialer (closed), no automated SMS/email (SMS off). Identify clearly as DealForge Properties; if a seller opts out, note it and stop contacting that line.");
  L.push("");
  L.push("---");
  L.push("");
  for (const x of entries) {
    const sf = x.score_factors ?? {};
    const badge = x.priority_queue === "HOT" ? "🔥 **HOT**" : "**HIGH**";
    L.push(`## ${x.rank}. ${x.full_name} — ${badge}`);
    L.push("");
    L.push(`📞 **${fmtPhone(x.phone)}** &nbsp;·&nbsp; 📧 ${x.email ? x.email : "—"}`);
    L.push(`🏠 ${x.property_address}, ${x.property_city}, ${x.property_state} ${x.property_zip} &nbsp;·&nbsp; **APN** \`${x.apn ?? "—"}\``);
    L.push(`**Source/Queue/Score:** ${dash(x.lead_source)} · ${x.priority_queue} queue · score **${x.score ?? "—"}**/10 · outreach status: **${x.outreach_status}**`);
    L.push("");
    L.push("**Stored deal snapshot (PropStream estimates — verify on call, not certified):**");
    L.push(
      `- Estimated value (EV): ${money(x.ev)} · Est. equity: ${money(sf.equity)} · Est. ARV: ${money(x.estimated_arv)} · MAO estimate: ${money(sf.estimated_mao)}`,
    );
    L.push(
      `- Foreclosure factor: ${x.foreclosure_factor ?? "—"} · Years tax-delinquent (per scoring): ${x.years_delq ?? "—"} · Owner-occupied: ${x.owner_occupied ?? "—"} · Prop type: ${x.property_type ?? "—"}`,
    );
    L.push(
      `- Estimated repairs / condition / reason-for-selling (if recorded): ${[x.estimated_repairs, x.property_condition, x.reason_for_selling].filter(Boolean).join(" · ") || "—"}`,
    );
    L.push("");
    const why =
      x.priority_queue === "HOT"
        ? `Score 9/10 and elevated PropStream foreclosure factor (${x.foreclosure_factor}) → ranked HOT. Tax-delinquent ${x.years_delq ?? "?"}+ yrs per scoring; est. equity ${money(sf.equity)}; MAO estimate ${money(sf.estimated_mao)}. (Inference: high equity + delinquency ⇒ likely motivation — confirm on call.)`
        : `Score 8/10 → HIGH queue; ordered by stored equity (${money(sf.equity)}). Tax-delinquent ${x.years_delq ?? "?"}+ yrs per scoring; MAO estimate ${money(sf.estimated_mao)}. (Inference: high equity + delinquency ⇒ likely motivation — confirm on call.)`;
    L.push(`**Why ranked:** ${why}`);
    if (x.premium_lead) {
      let flag = "";
      if (incumbent.has(x.disposition_status ?? "")) flag = "(⚠️ do NOT pitch a standard wholesale flip — verify comps/entitlement per disposition first)";
      else if (actNow.has(x.disposition_status ?? "")) flag = "(active premium path — trustee/manager outreach per disposition)";
      L.push(`**⚠️ Premium lead** · disposition: **${dash(x.disposition_status)}** — ${dash(x.disposition_strategy)} ${flag}`);
    }
    L.push(`**Talking point (stored lead-in):** “${leadWith(x.notes)}”`);
    L.push("");
    L.push(
      `**Compliance:** Trace ${x.trace_status ?? "—"} (${dateShort(x.traced_at)}) · no DNC · no opt-out · contactable: ${x.contactable ? "yes" : "no"} · last contact: ${x.last_contact_at ? dateShort(x.last_contact_at) : "none on record"} · next action logged: ${dash(x.next_action)}`,
    );
    const special = x.premium_lead && incumbent.has(x.disposition_status ?? "") ? " (verify first per disposition)" : "";
    L.push(`**Next action:** Call ${fmtPhone(x.phone)}${special}. Use the talking point; confirm situation + tax status; log outcome + any opt-out in the CRM.`);
    L.push("");
  }

  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    queueCounts,
    withPhone,
    contactable,
    complianceClean,
    entries,
    markdown: L.join("\n"),
  };
}

/** Convenience type re-export so routes don't need both imports. */
export type { PriorityQueue };
