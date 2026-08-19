// DealFlow AI — Trace-CSV Import (zero-spend pilot contact unlock)
//
// Loads the owner's PropStream Connect traced-contacts export into the CRM.
// Source: the full traced list the owner exported after the 2026-08-19 retry:
//   /home/team/shared/leads/Property Export Bexar+Top1000+2026-08.csv
//
// What it does, per row (matched by APN against leads.apn):
//   - picks the PRIMARY phone = first non-DNC *mobile/cell*, else first
//     non-DNC *landline*, else first phone of any kind, else none.
//   - DNC rule: a phone is FLAGGED when its "Phone N DNC" cell is non-empty
//     and not N/NO/FALSE (observed values: "Public DNC" and "1").
//   - If EVERY phone on a row is DNC-flagged we do NOT store a DNC number as
//     callable: phone stays empty, dnc_flag describes it (honest NOT
//     CONTACTABLE for calls).
//   - email = first non-empty Email 1..4, written only when the lead's email
//     is empty.
//   - Sets trace_status='TRACED', trace_source='propstream_connect_export',
//     traced_at=now(), invalid_contact=false.
//   - contactable = <has a non-DNC phone> — i.e. a callable number exists.
//     Recomputed explicitly AFTER the trigger (see below) so email-only or
//     DNC-only rows are never flagged callable.
//
// Idempotent / never clobbers: phone is only written when the lead has no
// phone yet; email only when the lead has no email yet. Re-running changes
// nothing (guarded WHERE clauses return 0 rows).
//
// Audit + job registry: one outreach_audit_log row per run (channel
// 'trace_import', the free-text channel per house style) and one COMPLETED
// skip_trace_jobs row; the old STALLED row (id=5) is updated with a
// "SUPERSEDED" note — kept honest, not deleted.
//
// Run from /home/team/shared/site:
//   bun run scripts/import-trace-csv.ts
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { logOutreachAudit } from "../src/lib/compliance";
import type { OutreachChannel } from "../src/lib/skip-trace";

const DEFAULT_CSV = "/home/team/shared/leads/Property Export Bexar+Top1000+2026-08.csv";
export const TRACE_LIST_NAME = "Bexar Top1000 2026-08";
export const TRACE_GROUP_ID = "owner-export-2026-08-19";
export const TRACE_SOURCE = "propstream_connect_export";
export const IMPORT_OPERATOR = "import-trace-csv";

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
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
        row = [];
      }
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ---------- phone / DNC helpers -------------------------------------------
/** DNC flagged = non-empty and not N / NO / FALSE (case-insensitive). */
export function isDncFlagged(v: unknown): boolean {
  const s = String(v ?? "").trim().toUpperCase();
  return s !== "" && s !== "N" && s !== "NO" && s !== "FALSE";
}
/** A cell is a usable phone only if it normalises to exactly 10 digits
 *  (guards the garbage "0" / "08/12/2026" cells that appear on no-APN rows). */
export function cleanPhone(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? d : null;
}
export function isMobileType(t: unknown): boolean {
  return /mobile|cell/i.test(String(t ?? ""));
}
/** Normalise an APN to how leads.apn is stored (trim whitespace only — the
 *  stored format, e.g. "09417-140-0080", exactly matches the CSV export). */
export function normalizeApn(v: unknown): string {
  return String(v ?? "").trim();
}

export interface ImportSummary {
  csvPath: string;
  dataRows: number;
  noApnSkipped: number;
  matched: number;
  unmatched: number;
  primaryChosen: number; // rows we picked a non-DNC phone for
  dncOnlySkipped: number; // rows where every phone was DNC-flagged (no phone written)
  noPhone: number; // rows with no phone at all in the export
  phoneFilledRows: number; // DB rows actually written a phone this run
  emailFilledRows: number; // DB rows actually written an email this run
  phoneCount: number; // leads with a phone after this run
  contactableCount: number; // leads contactable (callable) after this run
  tracedCount: number; // leads marked TRACED this run
}

/**
 * Parse the trace export and run the batch import. `opts.audit` / `opts.job`
 * control whether we write the summary audit row and the COMPLETED job row
 * (verify re-runs pass false so it never spams the registry).
 */
export async function runTraceImport(
  csvPath: string = DEFAULT_CSV,
  opts: { audit?: boolean; job?: boolean } = {},
): Promise<ImportSummary> {
  const sql: NeonQueryFunction<false, false> = neon(process.env.DATABASE_URL!);
  const audit = opts.audit ?? true;
  const job = opts.job ?? true;

  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(raw);
  const header = rows[0];
  if (!header || !header.includes("APN")) throw new Error(`CSV header missing APN column in ${csvPath}`);
  const data = rows.slice(1);

  const apnIdx = header.indexOf("APN");
  const phoneIdx = [1, 2, 3, 4, 5].map((n) => header.indexOf(`Phone ${n}`));
  const typeIdx = [1, 2, 3, 4, 5].map((n) => header.indexOf(`Phone ${n} Type`));
  const dncIdx = [1, 2, 3, 4, 5].map((n) => header.indexOf(`Phone ${n} DNC`));
  const emailIdx = [1, 2, 3, 4].map((n) => header.indexOf(`Email ${n}`));

  // ---- per-row phone/email/DNC decision --------------------------------
  interface RowPlan {
    apn: string;
    phone: string | null; // never a DNC-flagged number
    email: string | null;
    dnc: string; // '' when a clean number chosen; first flag when all-DNC
    contactable: boolean;
    hadPhoneCells: boolean; // row had ≥1 phone cell in the export
  }
  const plans: RowPlan[] = [];
  let noApn = 0;
  let primaryChosen = 0;
  let dncOnly = 0;
  let noPhone = 0;

  for (const r of data) {
    const apn = normalizeApn(r[apnIdx]);
    if (!apn) {
      noApn++;
      continue;
    }
    // collect valid phone cells (10-digit), tracking type + DNC status
    const cells: { num: string; type: string; dnc: string; flagged: boolean }[] = [];
    for (let i = 0; i < 5; i++) {
      const num = cleanPhone(r[phoneIdx[i]]);
      if (!num) continue;
      cells.push({
        num,
        type: String(r[typeIdx[i]] ?? "").trim(),
        dnc: String(r[dncIdx[i]] ?? "").trim(),
        flagged: isDncFlagged(r[dncIdx[i]]),
      });
    }
    const email = emailIdx.map((i) => String(r[i] ?? "").trim()).find((e) => e !== "") ?? null;

    let phone: string | null = null;
    let dnc = "";
    let contactable = false;
    if (cells.length === 0) {
      noPhone++;
    } else {
      const nonDnc = cells.filter((c) => !c.flagged);
      if (nonDnc.length > 0) {
        // first non-DNC mobile, else first non-DNC phone of any kind
        const mobile = nonDnc.find((c) => isMobileType(c.type));
        phone = (mobile ?? nonDnc[0]).num;
        dnc = ""; // chosen number is clean
        contactable = true;
        primaryChosen++;
      } else {
        // every phone is DNC-flagged → honest NOT CONTACTABLE for calls
        dnc = cells[0].dnc || "DNC";
        dncOnly++;
      }
    }
    plans.push({ apn, phone, email, dnc, contactable, hadPhoneCells: cells.length > 0 });
  }

  // ---- match against existing leads by APN (batch) ----------------------
  const apns = [...new Set(plans.map((p) => p.apn))];
  const existing = (
    (await sql`SELECT apn FROM leads WHERE apn = ANY(${apns})`) as { apn: string }[]
  ).map((r) => r.apn);
  const existingSet = new Set(existing);
  const matchedPlans = plans.filter((p) => existingSet.has(p.apn));
  const unmatched = plans.length - matchedPlans.length;

  // ---- UPDATE A: phone + dnc_flag + TRACED status (only when no phone yet)
  const phonePayload = matchedPlans.map((p) => ({
    apn: p.apn,
    phone: p.phone ?? "",
    dnc: p.dnc,
  }));
  let phoneFilled = 0;
  if (phonePayload.length > 0) {
    const res = (await sql`
      UPDATE leads AS l
      SET phone = NULLIF(btrim(v.phone), ''),
          dnc_flag = v.dnc,
          trace_status = 'TRACED',
          trace_source = ${TRACE_SOURCE},
          traced_at = now(),
          invalid_contact = false,
          updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(phonePayload)}) AS v(apn text, phone text, dnc text)
      WHERE l.apn = v.apn AND (l.phone IS NULL OR btrim(l.phone) = '')
    `) as unknown[];
    phoneFilled = res.length;
  }

  // ---- UPDATE B: email (only when lead has no email yet) ----------------
  const emailPayload = matchedPlans
    .filter((p) => p.email)
    .map((p) => ({ apn: p.apn, email: p.email }));
  let emailFilled = 0;
  if (emailPayload.length > 0) {
    const res = (await sql`
      UPDATE leads AS l
      SET email = v.email, updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(emailPayload)}) AS v(apn text, email text)
      WHERE l.apn = v.apn AND v.email <> '' AND (l.email IS NULL OR btrim(l.email) = '')
    `) as unknown[];
    emailFilled = res.length;
  }

  // ---- UPDATE C: authoritative contactable (callable) -------------------
  // Done as a SEPARATE UPDATE that does not touch phone/email/dnc, so the
  // leads_recompute_contactable trigger (which fires only on those columns)
  // cannot override our explicit value: contactable = <has a non-DNC phone>.
  const contactablePayload = matchedPlans.map((p) => ({ apn: p.apn, contactable: p.contactable }));
  if (contactablePayload.length > 0) {
    await sql`
      UPDATE leads AS l
      SET contactable = v.contactable, updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(contactablePayload)}) AS v(apn text, contactable boolean)
      WHERE l.apn = v.apn
    `;
  }

  // ---- record the completed job + supersede the stale STALLED row ------
  if (job) {
    const done = (await sql`
      SELECT id FROM skip_trace_jobs
      WHERE status = 'COMPLETED' AND list_name = ${TRACE_LIST_NAME}
      LIMIT 1
    `) as { id: number }[];
    if (done.length === 0) {
      await sql`
        INSERT INTO skip_trace_jobs
          (list_name, propstream_group_id, status, total_leads, traced_count, started_at, last_progress_at)
        VALUES
          (${TRACE_LIST_NAME}, ${TRACE_GROUP_ID}, 'COMPLETED', ${data.length}, ${
        matchedPlans.filter((p) => p.hadPhoneCells).length
      }, now(), now())
      `;
    }
    await sql`
      UPDATE skip_trace_jobs
      SET last_progress_at = now(),
          error_message = COALESCE(error_message, '')
            || ' SUPERSEDED 2026-08-19: the owner retried the PropStream Connect trace and exported the full traced list; '
            || 'results imported into the CRM via ' || ${IMPORT_OPERATOR} || '. Kept as STALLED for honest history — see the COMPLETED job for this list.'
      WHERE id = 5
        AND status = 'STALLED'
        AND POSITION('SUPERSEDED' IN COALESCE(error_message, '')) = 0
    `;
  }

  // ---- honest one-row audit summary -------------------------------------
  const tracedCount = matchedPlans.length;
  const phoneCount = (
    await sql`SELECT count(*)::int AS n FROM leads WHERE phone IS NOT NULL AND btrim(phone) <> ''`
  ) as { n: number }[];
  const contactableCount = (
    await sql`SELECT count(*)::int AS n FROM leads WHERE contactable = true`
  ) as { n: number }[];

  if (audit) {
    const reason =
      `PropStream Connect trace import: ${data.length} rows parsed, ${tracedCount} matched by APN, ` +
      `${primaryChosen} phone(s) written (first non-DNC mobile/landline), ${emailFilled} email(s) written, ` +
      `${dncOnly} DNC-only row(s) left NOT CONTACTABLE (no phone stored), ${noApn} row(s) skipped (no APN). ` +
      `phone rows actually written this run=${phoneFilled}, email rows actually written this run=${emailFilled}; ` +
      `total leads with a phone now=${phoneCount[0]?.n ?? 0}, total contactable (callable)=${contactableCount[0]?.n ?? 0}.`;
    await logOutreachAudit({
      channel: "trace_import" as unknown as OutreachChannel, // free-text summary channel (DB col is TEXT)
      direction: "outbound",
      status: "completed" as unknown as "sent", // free-text status (DB col is TEXT)
      reason,
      operator: IMPORT_OPERATOR,
    });
  }

  return {
    csvPath,
    dataRows: data.length,
    noApnSkipped: noApn,
    matched: tracedCount,
    unmatched,
    primaryChosen,
    dncOnlySkipped: dncOnly,
    noPhone,
    phoneFilledRows: phoneFilled,
    emailFilledRows: emailFilled,
    phoneCount: phoneCount[0]?.n ?? 0,
    contactableCount: contactableCount[0]?.n ?? 0,
    tracedCount,
  };
}

async function main() {
  const summary = await runTraceImport();
  console.log(JSON.stringify(summary, null, 2));
}
if (process.argv[1] && process.argv[1].endsWith("import-trace-csv.ts")) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  });
}
