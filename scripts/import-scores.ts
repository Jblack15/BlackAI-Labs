// DealFlow AI — Import REAL PropStream-adapted scores (PH1-B7)
//
// Imports the scored PropStream tax-delinquent export into the leads table
// (score, apn, score_factors jsonb) and recomputes priority queues, making the
// database the source of truth for lead scoring.
//
// Run from /home/team/shared/site:
//   bun run scripts/import-scores.ts
//
// Idempotent / re-runnable: rows are matched by (addr-core + name variant) —
// the same guard used by the original import (import-ps-taxdelq.mjs) — so
// re-running updates the same leads in place. Legacy leads without a CSV row
// keep score NULL (unscored) — never fabricated.
//
// After the score import it calls refreshPriorities() so every lead (including
// the 594 unscored legacy leads) gets its queue computed on available factors.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { computePriorityQueue } from "../src/lib/prioritization";

const CSV = "/home/team/shared/leads/lead-scores-ps-taxdelq.csv";
const sql = neon(process.env.DATABASE_URL!);

// ---------- robust CSV parser (quoted fields, embedded commas, "" escapes) ----------
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

// ---------- match helpers (mirrors import-ps-taxdelq.mjs / score_ps_taxdelq.py) ----------
const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function addrCore(a: string): string {
  a = String(a ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  a = a.replace(/\bSAN ANTONIO\b.*$/, "");
  a = a.replace(/\bTX\s*\d{5}\b.*$/, "");
  a = a.replace(/\b\d{5}\b\s*$/, "");
  a = a.replace(/,\s*TX\s*$/, "");
  a = a.replace(/^(\d+)\s+(?:N|S|E|W|NW|NE|SW|SE)\s+/, "$1 ");
  return a.trim();
}
function nameVariants(name: string): Set<string> {
  const n = norm(name);
  const parts = n.split(" ").filter(Boolean);
  const rev =
    parts.length > 1 ? norm(parts[parts.length - 1] + " " + parts.slice(0, -1).join(" ")) : n;
  return new Set([n, rev]);
}
function toNumOrNull(v: string): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const toBool = (v: string): boolean | null => {
  const s = String(v ?? "").toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
};

// ---------- load + parse CSV ----------
const grid = parseCsv(readFileSync(CSV, "utf8"));
const header = grid[0].map((h) => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
console.log(`parsed ${grid.length - 1} scored rows, ${header.length} cols`);
const required = ["name", "address", "apn", "score", "equity", "estimated_mao", "do_not_mail"];
for (const r of required) if (!(r in idx)) throw new Error(`missing column: ${r}`);

// ---------- load existing leads into a match index ----------
interface DbLead {
  id: string;
  full_name: string;
  property_address: string;
  contactable: boolean;
  outreach_status: string | null;
  dnc_flag: string | null;
  do_not_mail: boolean | null;
  opted_out: boolean | null;
  invalid_contact: boolean | null;
  wrong_number: boolean | null;
  score: number | null;
  apn: string | null;
}
const dbRows = (await sql`
  SELECT id, full_name, property_address, contactable, outreach_status, dnc_flag,
         do_not_mail, opted_out, invalid_contact, wrong_number, score, apn
  FROM leads
`) as Array<Omit<DbLead, "score"> & { score: string | number | null }>;
const index = new Map<string, DbLead[]>(); // addrCore -> leads
for (const r of dbRows) {
  const core = addrCore(r.property_address ?? "");
  if (!core) continue;
  const lead: DbLead = { ...r, score: r.score === null ? null : Number(r.score) };
  if (!index.has(core)) index.set(core, []);
  index.get(core)!.push(lead);
}
console.log(`loaded ${dbRows.length} leads (${index.size} addr-cores)`);

function findLead(core: string, name: string): DbLead | null {
  const candidates = index.get(core) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const variants = nameVariants(name);
  return (
    candidates.find((c) => {
      for (const v of variants) if (nameVariants(c.full_name).has(v)) return true;
      return false;
    }) ?? null
  );
}

// ---------- build update payload ----------
interface PayloadRow {
  id: string;
  apn: string | null;
  score: number | null;
  factors: Record<string, unknown>;
  q: string;
  dnm: boolean | null; // do_not_mail sync from CSV (real PropStream preference)
}
const payload: PayloadRow[] = [];
let unmatched = 0;
let skippedNoScore = 0;
const seenIds = new Set<string>();
for (const g of grid.slice(1)) {
  const get = (c: string) => (g[idx[c]] ?? "").trim();
  const name = get("name");
  const address = get("address");
  if (!name || !address) continue;
  const score = toNumOrNull(get("score"));
  if (score === null) {
    skippedNoScore++;
    continue;
  }
  const lead = findLead(addrCore(address), name);
  if (!lead) {
    unmatched++;
    continue;
  }
  if (seenIds.has(lead.id)) continue; // duplicate CSV row for the same lead
  seenIds.add(lead.id);
  const doNotMail = toBool(get("do_not_mail"));
  const factors: Record<string, unknown> = {
    rank: toNumOrNull(get("rank")),
    batch: toNumOrNull(get("batch")),
    lead_source: get("lead_source") || undefined,
    property_type: get("property_type") || undefined,
    sfr_gate: get("sfr_gate") || undefined,
    ev: toNumOrNull(get("ev")),
    equity: toNumOrNull(get("equity")),
    distress: toNumOrNull(get("distress")),
    equity_band: toNumOrNull(get("equity_band")),
    velocity: toNumOrNull(get("velocity")),
    contactability: toNumOrNull(get("contactability")),
    estimated_arv: toNumOrNull(get("estimated_arv")),
    estimated_mao: toNumOrNull(get("estimated_mao")),
    years_delq: toNumOrNull(get("years_delq")),
    owner_occupied: get("owner_occupied") || undefined,
    is_entity: get("is_entity") || undefined,
    mailing_state: get("mailing_state") || undefined,
    has_phone: get("has_phone") || undefined,
    do_not_mail: doNotMail ?? undefined,
    foreclosure_factor: get("foreclosure_factor") || undefined,
    eligible_batch1: get("eligible_batch1") || undefined,
  };
  payload.push({
    id: lead.id,
    apn: get("apn") || null,
    score,
    factors,
    q: computePriorityQueue({
      score,
      contactable: lead.contactable,
      outreach_status: lead.outreach_status,
      dnc_flag: lead.dnc_flag,
      do_not_mail: doNotMail ?? lead.do_not_mail,
      opted_out: lead.opted_out,
      invalid_contact: lead.invalid_contact,
      wrong_number: lead.wrong_number,
      score_factors: factors,
    }),
    dnm: doNotMail,
  });
}
console.log(
  `matched ${payload.length} leads for update; ${unmatched} CSV rows unmatched; ${skippedNoScore} rows without a score`,
);

// ---------- apply in chunks ----------
const CHUNK = 1000;
let applied = 0;
for (let i = 0; i < payload.length; i += CHUNK) {
  const chunk = payload.slice(i, i + CHUNK);
  await sql`
    UPDATE leads AS l
    SET apn = v.apn,
        score = v.score,
        score_factors = v.factors,
        do_not_mail = COALESCE(v.dnm, l.do_not_mail),
        priority_queue = v.q,
        priority_updated_at = now(),
        updated_at = now()
    FROM jsonb_to_recordset(${JSON.stringify(
      chunk.map((p) => ({ id: p.id, apn: p.apn, score: p.score, factors: p.factors, q: p.q, dnm: p.dnm })),
    )}) AS v(id uuid, apn text, score numeric, factors jsonb, q text, dnm boolean)
    WHERE l.id = v.id
  `;
  applied += chunk.length;
  console.log(`  applied ${applied}/${payload.length}`);
}

// ---------- verify ----------
const dist = await sql`
  SELECT COALESCE(priority_queue, 'UNSCORED') AS queue, COUNT(*)::int AS count
  FROM leads GROUP BY 1 ORDER BY 2 DESC
`;
console.log("queue distribution after import:");
for (const r of dist) console.log(`  ${r.queue}: ${r.count}`);
const scored = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE score IS NOT NULL`;
console.log(`leads with score: ${scored[0].n} (expect 6,556)`);
const apnCount = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE apn IS NOT NULL`;
console.log(`leads with apn: ${apnCount[0].n}`);
console.log("Done.");
process.exit(0);
