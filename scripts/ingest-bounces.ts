// DealFlow AI — Ingestion of email hard-bounce / blocked notifications
// ===========================================================================
// PURPOSE
//   Reads Gmail Mail Delivery Subsystem hard-bounce ("Address not found") and
//   "Message blocked" notifications captured in a text file and, for every
//   address that matches a lead in the CRM:
//     1. Suppresses the lead (sets leads.invalid_contact = true) so the
//        self-pacing sender (scripts/send-email-paced.ts) and every future
//        campaign skip them forever (the paced sender filters on
//        `l.invalid_contact = false`; the email compliance gate in
//        src/lib/skip-trace.ts assertOutreachAllowed() blocks email on
//        invalid_contact/opted_out).
//     2. Writes an outreach_audit_log row (operator='system-bounce-ingest') so
//        the suppression is auditable and attributable to this ingest.
//     3. Marks the matching email_logs rows status='bounced' (with reason in
//        `error`) so the honest delivered count (email_logs WHERE status='sent')
//        excludes them — the send record is KEPT for the audit trail, it is
//        just no longer counted as delivered.
//
//   This tool NEVER sends email. It only READS the DB + input file and WRITES
//   suppression / audit / delivery-state rows. It does not call
//   sendSellerEmail and does not touch SMTP/DMARC/SPF or any network path.
//
// SAFETY / IDEMPOTENCY
//   - DRY_RUN defaults to "1" (ON). DRY_RUN prints exactly what it would
//     change without writing a single row. To actually apply, run DRY_RUN=0.
//   - Fully idempotent / re-runnable: a second (or third) run does NOT
//     double-write audit rows, does NOT re-mark already-bounced email_logs
//     rows, and does not error. New addresses appended to the input file on a
//     later run are ingested while already-processed ones are skipped.
//   - Malformed addresses (no '@') are ignored; the section parser walks the
//     file by section header so appending more addresses later "just works".
//
// INPUT FILE (env BOUNCE_FILE, default /home/team/shared/bounces-2026-08-22.txt)
//   Sections are introduced by a line beginning `"Address not found"` (reason
//   = hard_bounce) or `"Message blocked"` (reason = blocked). Blank / header /
//   comment lines are ignored. Any non-empty line containing '@' while a
//   section is active is treated as an address for that section.
//
// Run (from /home/team/shared/site):
//   DRY_RUN=1                       bun scripts/ingest-bounces.ts        (preview; default, writes NOTHING)
//   DRY_RUN=0                       bun scripts/ingest-bounces.ts        (REAL apply — writes suppression/audit/state rows)
//   DRY_RUN=1 BOUNCE_FILE=/path/x   bun scripts/ingest-bounces.ts        (different input file)
//
// Requires DATABASE_URL in env.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const BOUNCE_FILE = process.env.BOUNCE_FILE || "/home/team/shared/bounces-2026-08-22.txt";
// Attribution + idempotency marker for this ingest (matches the audit log
// `operator` column, which we also query to avoid double-writing audit rows).
const OPERATOR = "system-bounce-ingest";
// Section header -> reason. The parser keys on the leading quoted label so
// future additions to the file only need to keep the same headers.
const SECTION_START: Array<{ startsWith: string; reason: string; label: string }> = [
  { startsWith: '"Address not found"', reason: "hard_bounce", label: "Address not found (hard bounce)" },
  { startsWith: '"Message blocked"', reason: "blocked", label: "Message blocked (non-delivered)" },
];

type BounceEntry = { address: string; reason: string; label: string };

/** Parse the bounce file into a deduped (case-insensitive) list of entries.
 *  Robust to appended addresses: each section header toggles the active reason
 *  for subsequent lines. */
function parseBounceFile(filePath: string): BounceEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const entries: BounceEntry[] = [];
  const seen = new Set<string>();
  let active: { reason: string; label: string } | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sect = SECTION_START.find((s) => trimmed.startsWith(s.startsWith));
    if (sect) {
      active = { reason: sect.reason, label: sect.label };
      continue;
    }
    // A plain line is an address only if we are inside a section it contains '@'.
    if (!active || !trimmed.includes("@")) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue; // de-dupe (idempotent across repeated/appended runs)
    seen.add(key);
    entries.push({ address: trimmed, reason: active.reason, label: active.label });
  }
  return entries;
}

async function deliveredCount(): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS n FROM email_logs WHERE status = 'sent'`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function main() {
  const dryRun = (process.env.DRY_RUN ?? "1") !== "0";
  if (!process.env.DATABASE_URL) {
    console.error("BLOCKED — DATABASE_URL not set. Nothing written.");
    process.exit(2);
  }
  const entries = parseBounceFile(BOUNCE_FILE);
  const nAddresses = entries.length;
  if (nAddresses === 0) {
    console.error(`No bounce addresses parsed from ${BOUNCE_FILE} — nothing to do.`);
    process.exit(0);
  }
  const hardCount = entries.filter((e) => e.reason === "hard_bounce").length;
  const blockedCount = entries.filter((e) => e.reason === "blocked").length;

  const deliveredBefore = await deliveredCount();
  const mode = dryRun ? "DRY-RUN (preview only, NOTHING written)" : "REAL APPLY (writes rows)";
  console.log(`== Email bounce ingest ==`);
  console.log(`Input file: ${BOUNCE_FILE}`);
  console.log(`Addresses in input:   ${nAddresses}  (${hardCount} hard_bounce / ${blockedCount} blocked)`);
  console.log(`EMAIL_LOG delivered count (status='sent') BEFORE: ${deliveredBefore}`);
  console.log(`MODE: ${mode}`);
  if (dryRun) console.log(`(DRY_RUN is ON — no rows will be written. Set DRY_RUN=0 to apply.)`);

  const matchedLeads = new Set<string>(); // lead ids matched
  let newlySuppressed = 0;
  let emailRowsToFlip = 0;
  const unmatched: string[] = [];

  for (const entry of entries) {
    const leadRows = (await sql`
      SELECT id FROM leads WHERE lower(btrim(email)) = lower(${entry.address})
    `) as { id: string }[];

    if (!leadRows.length) {
      unmatched.push(entry.address);
      console.log(`UNMATCHED [${entry.reason}] ${entry.address} — no lead has this email`);
      continue;
    }

    for (const lead of leadRows) {
      matchedLeads.add(lead.id);
      // How many email_logs rows would flip sent -> bounced (idempotent UPDATE guarded by status='sent').
      const flipRows = (await sql`
        SELECT count(*)::int AS n FROM email_logs
        WHERE lead_id = ${lead.id} AND status = 'sent' AND lower(to_email) = lower(${entry.address})
      `) as { n: number }[];
      const flipN = flipRows[0]?.n ?? 0;

      // Already suppressed? Only count as "newly suppressed" the first time.
      const cur = (await sql`
        SELECT invalid_contact FROM leads WHERE id = ${lead.id}
      `) as { invalid_contact: boolean }[];
      const alreadySuppressed = cur[0]?.invalid_contact === true;

      // Existing audit row for this exact ingest? (idempotency guard — avoid doubles).
      const existingAudit = (await sql`
        SELECT 1 FROM outreach_audit_log
        WHERE operator = ${OPERATOR} AND contact_value = ${entry.address} AND reason = ${entry.reason}
        LIMIT 1
      `) as { "?column?": number }[];

      console.log(
        `MATCH ${entry.reason.padEnd(11)} ${entry.address} -> lead ${lead.id}` +
          ` | email_logs sent->bounced: ${flipN}` +
          ` | new suppression: ${alreadySuppressed ? "no (already)" : "yes"}` +
          ` | audit row: ${existingAudit.length ? "exists (skip)" : "add"}`,
      );

      if (!dryRun) {
        // 1. Suppress the lead so no future campaign / paced send reaches them.
        if (!alreadySuppressed) {
          await sql`UPDATE leads SET invalid_contact = true WHERE id = ${lead.id}`;
          newlySuppressed++;
        }
        // 2. Mark the send(s) as non-delivered (keep the row — honest audit trail).
        if (flipN > 0) {
          await sql`
            UPDATE email_logs
            SET status = 'bounced',
                error = ${`${entry.reason}: ${entry.label}`}
            WHERE lead_id = ${lead.id} AND status = 'sent' AND lower(to_email) = lower(${entry.address})
          `;
          emailRowsToFlip += flipN;
        }
        // 3. Auditable suppression record (deduped — never double-written).
        if (!existingAudit.length) {
          await sql`
            INSERT INTO outreach_audit_log
              (lead_id, channel, direction, status, reason, contact_value, content_preview, operator)
            VALUES
              (${lead.id}, 'email', 'inbound', 'blocked', ${entry.reason}, ${entry.address},
               ${`bounce-ingest ${entry.label} (source ${BOUNCE_FILE.split("/").pop()})`}, ${OPERATOR})
          `;
        }
      } else {
        if (!alreadySuppressed) newlySuppressed++;
        emailRowsToFlip += flipN;
      }
    }
  }

  const deliveredAfter = dryRun
    ? deliveredBefore - (dryRun ? emailRowsToFlip : 0) // predicted in dry run
    : await deliveredCount(); // real value after writes

  console.log(`\n=== SUMMARY (${mode}) ===`);
  console.log(`Addresses in input:                     ${nAddresses}`);
  console.log(`Matched to leads:                       ${matchedLeads.size} (${entries.length - unmatched.length} addresses)`);
  console.log(`Leads newly suppressed (invalid_contact): ${dryRun ? `would suppress ${newlySuppressed}` : newlySuppressed}`);
  console.log(`email_logs rows marked bounced:         ${dryRun ? `would mark ${emailRowsToFlip}` : emailRowsToFlip} (kept for audit trail, status='sent' removed)`);
  console.log(`Delivered count (email_logs status='sent'): BEFORE ${deliveredBefore}  ->  AFTER ${dryRun ? "(would be) " : ""}${deliveredAfter}`);
  if (unmatched.length) {
    console.log(`\nUNMATCHED addresses (no lead found — needs QA): ${unmatched.length}`);
    unmatched.forEach((a) => console.log(`  - ${a}`));
  } else {
    console.log(`\nAll ${nAddresses} addresses matched a lead. No unmatched QA needed.`);
  }
  if (dryRun) {
    console.log(`\nDRY_RUN completed — NOTHING was written. Re-run with DRY_RUN=0 to apply the suppression + audit + delivered-count.`);
  } else {
    console.log(`\nApplied. Auditable rows written with operator='${OPERATOR}'.`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
