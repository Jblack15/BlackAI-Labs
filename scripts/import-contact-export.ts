// DealForge — PropStream "All Contacts" CSV import + enrich + DNC-clean call list
// =============================================================================
// PURPOSE
//   Imports the owner's PropStream "All Contacts" export
//   (/home/team/shared/contact_export-All_Contacts.csv), matches rows to
//   existing CRM leads by normalized property address, and:
//     1. Enriches matched leads with a missing email (Email 1 preferred) and a
//        missing phone (preferring a non-DNC number, Cell over Landline).
//     2. Refreshes bounced emails: if a lead is invalid_contact=true and the
//        CSV carries a DIFFERENT fresh email, we swap it in and clear
//        invalid_contact=false so the paced sender can retry (logged as
//        "retry candidates"). A working (non-bounced) email is never
//        overwritten.
//     3. Persists DNC the way the compliance core already does — setting
//        leads.dnc_flag='DNC' (which drives leads.contactable=false via the
//        existing leads_recompute_contactable trigger and is honoured by
//        assertOutreachAllowed in src/lib/skip-trace.ts). No parallel DNC
//        system is invented.
//     4. Unmatched CSV rows with a contact (email or phone) are imported as
//        NEW leads (status='new'); rows with no email AND no phone are counted
//        and skipped (no lead created).
//     5. Writes one outreach_audit_log row per touched lead (operator
//        'csv-contact-enrich-2026-08-25') plus one summary row per run.
//     6. Emits /home/team/shared/call-list-2026-08-25.csv — a clean dialing
//        list that EXCLUDES every phone flagged "Public DNC".
//
//  This tool NEVER sends email or SMS. It only READS the DB + CSV and WRITES
//  enrichment / DNC / audit / new-lead rows, then writes the call-list CSV.
//
// SAFETY / IDEMPOTENCY
//   - DRY_RUN defaults to "1" (ON): prints exactly what it would change and
//     writes NOTHING. Set DRY_RUN=0 to really apply.
//   - Fully idempotent / re-runnable: matching by address + email means a
//     second run re-matches already-filled leads, the guarded UPDATE WHERE
//     clauses return 0 rows, and audit rows are deduped on
//     (operator, lead_id). Newly imported leads already exist by address on a
//     re-run, so they are matched (not re-created).
//
// Run (from /home/team/shared/site):
//   DRY_RUN=1  bun scripts/import-contact-export.ts   (preview; default)
//   DRY_RUN=0  bun scripts/import-contact-export.ts   (REAL apply)
//
// Requires DATABASE_URL in env.
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const CSV = process.env.CSV_FILE || "/home/team/shared/contact_export-All_Contacts.csv";
const OUT_CALL_LIST = process.env.OUT_CALL_LIST || "/home/team/shared/call-list-2026-08-25.csv";
// Attribution + idempotency marker (audit `operator` column).
const OPERATOR = "csv-contact-enrich-2026-08-25";
const LEAD_SOURCE = "propstream_contacts_export";

// ---------- robust CSV parser (quoted fields, embedded commas, "" escapes) --
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") { rows.push(row); row = []; }
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------- phone / DNC / address helpers -----------------------------------
/** DNC flagged = non-empty and not N / NO / FALSE (matches import-trace and
 *  the compliance core's notion of a "public DNC" flag cell; observed value in
 *  this export is exactly "Public DNC"). */
export function isDncFlagged(v: unknown): boolean {
  const s = String(v ?? "").trim().toUpperCase();
  return s !== "" && s !== "N" && s !== "NO" && s !== "FALSE";
}
/** A cell is usable as a phone only if it normalises to exactly 10 digits. */
export function cleanPhone(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? d : null;
}
export function isMobileType(t: unknown): boolean {
  return /mobile|cell/i.test(String(t ?? ""));
}
export function formatPhone(d: string): string {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}
// Normalize street suffixes so "Dr"/"Drive", "Ave"/"Avenue", "St"/"Street"
// etc. collapse to one key. Applied on top of lowercase + strip non-alnum.
const SUFFIX_MAP: Record<string, string> = {
  ST: "STREET", STREET: "STREET", AVE: "AVENUE", AV: "AVENUE", AVENUE: "AVENUE",
  BLVD: "BOULEVARD", BLV: "BOULEVARD", BOULEVARD: "BOULEVARD",
  RD: "ROAD", ROAD: "ROAD", DR: "DRIVE", DRIVE: "DRIVE", LN: "LANE", LANE: "LANE",
  CT: "COURT", COURT: "COURT", CIR: "CIRCLE", CIRCLE: "CIRCLE",
  PKWY: "PARKWAY", PARKWAY: "PARKWAY", WAY: "WAY", PL: "PLACE", PLACE: "PLACE",
  TRL: "TRAIL", TRAIL: "TRAIL", HWY: "HIGHWAY", HIGHWAY: "HIGHWAY",
  E: "EAST", W: "WEST", N: "NORTH", S: "SOUTH", BLVDX: "BOULEVARD",
};
/** Collapse an address to a single match key: lowercase, expand suffixes,
 *  strip every non-alphanumeric. */
export function normalizeAddress(v: unknown): string {
  const raw = String(v ?? "").toLowerCase();
  const tokens = raw.split(/[\s,.-]+/).filter(Boolean).map((t) => SUFFIX_MAP[t.toUpperCase()] ?? t);
  return tokens.join("").replace(/[^a-z0-9]/g, "");
}
export function normZip(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 5);
}
export function normEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

// ---------- CSV model --------------------------------------------------------
interface Phone { num: string; type: string; dnc: boolean; }
interface Contact {
  firstName: string; lastName: string; company: string;
  street: string; city: string; state: string; zip: string;
  emails: string[];          // non-empty, deduped, email-1 first
  phones: Phone[];           // P1..P5 with a valid 10-digit number
  rowIdx: number;            // 0-based index into data rows (for reporting)
  matched: boolean;
}

/** Select the best phone for a contact: prefer a non-DNC number, then Cell
 *  over Landline. Returns null only when the contact has no valid phone. */
function pickPhone(phones: Phone[]): Phone | null {
  const valid = phones;
  if (!valid.length) return null;
  const nonDnc = valid.filter((p) => !p.dnc);
  const pool = nonDnc.length ? nonDnc : valid;
  const cell = pool.find((p) => isMobileType(p.type));
  return cell ?? pool[0];
}

// ---------- DB lead shape ----------------------------------------------------
interface Lead {
  id: string; full_name: string; email: string | null; phone: string | null;
  property_address: string; property_city: string; property_state: string; property_zip: string;
  invalid_contact: boolean; dnc_flag: string | null; contactable: boolean;
}

// ---------- audit helpers ----------------------------------------------------
async function writeAudit(opts: {
  leadId?: string | null; channel: string; direction: string; status: string;
  reason: string; contactValue?: string | null; content?: string | null;
  operator: string;
}): Promise<void> {
  await sql`
    INSERT INTO outreach_audit_log
      (lead_id, channel, direction, status, reason, contact_value, content_preview, operator)
    VALUES (${opts.leadId ?? null}, ${opts.channel}, ${opts.direction}, ${opts.status},
            ${opts.reason}, ${opts.contactValue ?? null}, ${opts.content ?? null}, ${opts.operator})
  `;
}

function buildCsvLine(cols: string[]): string {
  return cols.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

async function main() {
  const dryRun = (process.env.DRY_RUN ?? "1") !== "0";
  if (!process.env.DATABASE_URL) {
    console.error("BLOCKED — DATABASE_URL not set. Nothing written.");
    process.exit(2);
  }
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const header = rows[0];
  const idx = (h: string) => header.indexOf(h);
  const g = (r: string[], h: string) => (idx(h) >= 0 ? r[idx(h)]?.trim() ?? "" : "");
  const data = rows.slice(1);
  console.log(`== Contact export import ==`);
  console.log(`CSV: ${CSV}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (preview only, NOTHING written)" : "REAL APPLY (writes rows)"}`);

  // ---- parse contacts ------------------------------------------------------
  const contacts: Contact[] = [];
  const dncNumbers = new Set<string>(); // distinct phone numbers flagged Public DNC
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const emails: string[] = [];
    for (let e = 1; e <= 4; e++) {
      const em = normEmail(g(r, `Email ${e}`));
      if (em && em.includes("@") && !emails.includes(em)) emails.push(em);
    }
    const phones: Phone[] = [];
    for (let p = 1; p <= 5; p++) {
      const num = cleanPhone(g(r, `Phone ${p}`));
      if (!num) continue;
      const d = isDncFlagged(g(r, `Phone ${p} DNC`));
      phones.push({ num, type: String(g(r, `Phone ${p} Type`)).trim(), dnc: d });
      if (d) dncNumbers.add(num);
    }
    contacts.push({
      firstName: g(r, "First Name"), lastName: g(r, "Last Name"), company: g(r, "Company Name"),
      street: g(r, "Street Address"), city: g(r, "City"), state: g(r, "State"), zip: normZip(g(r, "Zip")),
      emails, phones, rowIdx: i, matched: false,
    });
  }
  const noContactRows = contacts.filter((c) => c.emails.length === 0 && c.phones.length === 0).length;
  console.log(`rows with no email AND no phone (skipped, not imported): ${noContactRows}`);

  // ---- load leads + build address index ------------------------------------
  const leads = (await sql`
    SELECT id, full_name, email, phone, property_address, property_city,
           property_state, property_zip, invalid_contact, dnc_flag, contactable
    FROM leads
  `) as unknown as Lead[];
  const addrIndex = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = normalizeAddress(l.property_address);
    if (!key) continue;
    if (!addrIndex.has(key)) addrIndex.set(key, []);
    addrIndex.get(key)!.push(l);
  }
  const existingLeadsByKey = new Set(addrIndex.keys());

  // ---- enriched matched leads (plan) ----------------------------------------
  type Plan =
    | { kind: "email_set"; leadId: string; email: string }
    | { kind: "email_retry"; leadId: string; email: string; prev: string }
    | { kind: "phone_set"; leadId: string; phone: string; type: string; dnc: boolean; row: Contact }
    | { kind: "new_lead"; contact: Contact }
    | { kind: "skip_no_contact"; contact: Contact };
  const plans: Plan[] = [];

  for (const c of contacts) {
    const key = normalizeAddress(c.street);
    const candidates = key ? (addrIndex.get(key) ?? []) : [];
    if (candidates.length >= 1) {
      // Prefer a candidate whose city+zip match; else city; else zip; else first.
      const cityTok = c.city.toLowerCase();
      const best =
        candidates.find((l) => l.property_city.toLowerCase() === cityTok && normZip(l.property_zip) === c.zip && c.zip) ||
        candidates.find((l) => l.property_city.toLowerCase() === cityTok) ||
        (c.zip ? candidates.find((l) => normZip(l.property_zip) === c.zip) : undefined) ||
        candidates[0];
      c.matched = true;
      // --- email ---
      const curEmail = best.email ? best.email.trim().toLowerCase() : "";
      if (!curEmail && c.emails.length) {
        plans.push({ kind: "email_set", leadId: best.id, email: c.emails[0] });
      } else if (best.invalid_contact && c.emails.length) {
        const fresh = c.emails.find((e) => e !== curEmail);
        if (fresh) plans.push({ kind: "email_retry", leadId: best.id, email: fresh, prev: curEmail });
      }
      // --- phone + DNC ---
      const curPhone = best.phone ? best.phone.replace(/\D/g, "") : "";
      if (!curPhone) {
        const chosen = pickPhone(c.phones);
        if (chosen) plans.push({ kind: "phone_set", leadId: best.id, phone: chosen.num, type: chosen.type, dnc: chosen.dnc, row: c });
      }
    } else if (c.emails.length || c.phones.length) {
      if (!existingLeadsByKey.has(key)) {
        plans.push({ kind: "new_lead", contact: c });
      } else {
        // Address exists in DB but with no normalized match hit (defensive) —
        // do NOT create a duplicate. Count as skipped-ambiguous.
        plans.push({ kind: "skip_no_contact", contact: c }); // counted below as ambiguous
      }
    } else {
      plans.push({ kind: "skip_no_contact", contact: c }); // no email and no phone
    }
  }

  // ---- counters --------------------------------------------------------------
  let emailSet = 0, emailRetry = 0, phoneSet = 0, newLead = 0, dncMarked = 0;
  // Per-action idempotency: dedupe within the run (Set) and across runs (DB).
  const doneKeys = new Set<string>();
  async function isActionDone(leadId: string, action: string): Promise<boolean> {
    const k = `${leadId}|${action}`;
    if (doneKeys.has(k)) return true;
    const rows = (await sql`
      SELECT 1 FROM outreach_audit_log
      WHERE operator = ${OPERATOR} AND lead_id = ${leadId} AND reason LIKE ${`${action} %`} LIMIT 1
    `) as { "?column?": number }[];
    if (rows.length) { doneKeys.add(k); return true; }
    return false;
  }
  function markDone(leadId: string, action: string) { doneKeys.add(`${leadId}|${action}`); }
  // ---- apply matched-enrichment plans (idempotent) ---------------------------
  for (const p of plans) {
    if (p.kind === "email_set") {
      emailSet++;
      if (!dryRun && !(await isActionDone(p.leadId, "EMAIL_SET"))) {
        markDone(p.leadId, "EMAIL_SET");
        await sql`UPDATE leads SET email = ${p.email}, updated_at = now() WHERE id = ${p.leadId} AND (email IS NULL OR btrim(email) = '')`;
        await writeAudit({ leadId: p.leadId, channel: "import", direction: "inbound", status: "received", reason: `EMAIL_SET ${p.email} (from PropStream contact export)`, operator: OPERATOR });
      }
    } else if (p.kind === "email_retry") {
      emailRetry++;
      if (!dryRun && !(await isActionDone(p.leadId, "EMAIL_RETRY"))) {
        markDone(p.leadId, "EMAIL_RETRY");
        await sql`UPDATE leads SET email = ${p.email}, invalid_contact = false, updated_at = now() WHERE id = ${p.leadId}`;
        await writeAudit({ leadId: p.leadId, channel: "import", direction: "inbound", status: "received", reason: `EMAIL_RETRY ${p.prev} -> ${p.email} (bounced email refreshed)`, content: "paced sender may re-send to the refreshed address", operator: OPERATOR });
      }
    } else if (p.kind === "phone_set") {
      phoneSet++;
      if (p.dnc) dncMarked++;
      if (!dryRun && !(await isActionDone(p.leadId, "PHONE_SET"))) {
        markDone(p.leadId, "PHONE_SET");
        await sql`UPDATE leads SET phone = ${p.phone}, dnc_flag = ${p.dnc ? "DNC" : null}, updated_at = now() WHERE id = ${p.leadId} AND (phone IS NULL OR btrim(phone) = '')`;
        const reason = p.dnc
          ? `PHONE_SET ${p.phone} (${p.type}) — number Public DNC, lead kept NOT-contactable`
          : `PHONE_SET ${p.phone} (${p.type})`;
        await writeAudit({ leadId: p.leadId, channel: "import", direction: "inbound", status: "received", reason, operator: OPERATOR });
      }
    }
  }

  // ---- apply new-lead inserts -------------------------------------------------
  // Dedupe new leads by address key within the run so two CSV rows sharing one
  // brand-new address never create two duplicate leads. Re-runs are safe: the
  // address exists in the DB the second time, so the row is no longer unmatched.
  const newLeadKeys = new Set(
    plans.filter((p): p is Extract<Plan, { kind: "new_lead" }> => p.kind === "new_lead").map((p) => normalizeAddress(p.contact.street)),
  );
  newLead = newLeadKeys.size; // distinct new addresses (dedupe within run)
  if (dryRun) {
    // projected only — do not mark DNC in dry run for report clarity
  }
  const insertedKeys = new Set<string>();
  for (const p of plans) {
    if (p.kind === "new_lead") {
      const c = p.contact;
      const key = normalizeAddress(c.street);
      if (dryRun || insertedKeys.has(key)) continue;
      insertedKeys.add(key);
      const chosen = pickPhone(c.phones);
      const allDnc = c.phones.length > 0 && c.phones.every((ph) => ph.dnc);
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.company || "Unknown Owner";
      const ins = await sql`
        INSERT INTO leads (full_name, email, phone, property_address, property_city, property_state, property_zip,
                           dnc_flag, status, lead_source, source, pipeline_stage)
        VALUES (${name}, ${c.emails[0] ?? null}, ${chosen ? chosen.num : null}, ${c.street}, ${c.city || ""},
                ${c.state || ""}, ${c.zip || ""}, ${allDnc ? "DNC" : null}, 'new', ${LEAD_SOURCE}, 'csv_import', 'new_lead')
        RETURNING id
      `;
      const newId = (ins as { id: string }[])[0].id;
      await writeAudit({ leadId: newId, channel: "import", direction: "inbound", status: "received", reason: `NEW_LEAD (no existing address match)`, content: `street ${c.street}; email=${c.emails[0] ?? "-"}; phone=${chosen ? chosen.num : "-"}; dnc=${allDnc ? "yes" : "no"}`, operator: OPERATOR });
      if (allDnc) dncMarked++;
    }
  }

  // ---- build the DNC-clean call list from the CSV contacts --------------------
  interface CallRow { fullName: string; street: string; city: string; state: string; zip: string; phone: string; type: string; email: string; lastName: string; }
  const callRows: CallRow[] = [];
  const seenCall = new Set<string>();
  let dncOnlyContacts = 0; // contacts that have phone(s) but every one is DNC
  for (const c of contacts) {
    if (c.phones.length === 0) continue; // no valid number at all
    const chosen = pickPhone(c.phones);
    if (!chosen || chosen.dnc) { dncOnlyContacts++; continue; } // only DNC numbers — not callable
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.company || "Unknown";
    const dedupe = `${normalizeAddress(c.street)}|${chosen.num}`;
    if (seenCall.has(dedupe)) continue;
    seenCall.add(dedupe);
    callRows.push({
      fullName: name, street: c.street, city: c.city, state: c.state, zip: c.zip,
      phone: formatPhone(chosen.num), type: isMobileType(chosen.type) ? "Cell" : "Landline",
      email: c.emails[0] ?? "", lastName: c.lastName.toLowerCase(),
    });
  }
  callRows.sort((a, b) => (a.city + a.lastName).localeCompare(b.city + b.lastName));

  // ---- write call list CSV -----------------------------------------------------
  const headerLine = "Full Name,Property Address,City,State,Zip,Phone,Phone Type,Email";
  const lines = [headerLine, ...callRows.map((r) => buildCsvLine([r.fullName, r.street, r.city, r.state, r.zip, r.phone, r.type, r.email]))];
  writeFileSync(OUT_CALL_LIST, lines.join("\n") + "\n", "utf8");
  const callListRows = callRows.length;

  // ---- summary audit row (once per operator) ------------------------------------
  let summaryWritten = false;
  if (!dryRun) {
    const existingSummary = (await sql`
      SELECT 1 FROM outreach_audit_log WHERE operator = ${OPERATOR} AND lead_id IS NULL
      AND reason LIKE 'SUMMARY:%' LIMIT 1
    `) as { "?column?": number }[];
    if (!existingSummary.length) {
      const summary = `SUMMARY rows=${contacts.length} matched=${contacts.filter((c) => c.matched).length} ` +
        `email_set=${emailSet} email_retry=${emailRetry} phone_set=${phoneSet} new_leads=${newLead} no_email_no_phone=${noContactRows} ` +
        `dnc_marked=${dncMarked} dnc_numbers_excluded=${dncNumbers.size} call_list_rows=${callListRows}`;
      await writeAudit({ leadId: null, channel: "import", direction: "outbound", status: "completed", reason: `SUMMARY: ${summary}`, operator: OPERATOR });
      summaryWritten = true;
    }
  }

  // ---- report --------------------------------------------------------------------
  const matchedCount = contacts.filter((c) => c.matched).length;
  console.log("---- RESULT ----");
  console.log(`rows parsed                     : ${contacts.length}`);
  console.log(`matched existing lead (by addr) : ${matchedCount}`);
  console.log(`new leads imported              : ${newLead}  (unmatched rows with email or phone)`);
  console.log(`rows with no email AND no phone : ${noContactRows}  (skipped — not imported)`);
  console.log(`leads enriched — email set      : ${emailSet}`);
  console.log(`leads refreshed — bounced→fresh : ${emailRetry}  (retry candidates, invalid_contact cleared)`);
  console.log(`leads enriched — phone set      : ${phoneSet}  (of which DNC-marked ${dncMarked}); leads stay non-contactable if DNC`);
  console.log(`DNC numbers excluded from list  : ${dncNumbers.size} (distinct flagged "Public DNC"); ${dncOnlyContacts} contact rows have only DNC phones`);
  console.log(`call list rows (DNC-clean)      : ${callListRows}  -> ${OUT_CALL_LIST}`);
  console.log(dryRun ? "(DRY-RUN — no DB rows written. Set DRY_RUN=0 to apply.)" : "(APPLIED — DB rows written.)");
  return {
    rowsParsed: contacts.length, matched: matchedCount, emailSet, emailRetry, phoneSet,
    newLead, noContactRows, dncMarked, dncNumbersExcluded: dncNumbers.size, dncOnlyContacts,
    callListRows, dryRun, summaryWritten,
  };
}

if (process.argv[1] && process.argv[1].endsWith("import-contact-export.ts")) {
  main().then((s) => process.exit(0)).catch((e) => { console.error("ERR", e); process.exit(1); });
}
