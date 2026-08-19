// DealFlow AI — CSV lead import helpers.
//
// Shared by the /crm/import page (client-side parsing + mapping preview) and the
// server-side import function. Keeping the parse/detect/validate logic here lets
// it be unit-tested with bun and reused by future import entry points.
import type { NeonQueryFunction } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Lead fields the importer can write. Whitelist doubles as the mapping targets
// and the INSERT column list — never interpolate user strings into SQL.
// ---------------------------------------------------------------------------
export const LEAD_FIELDS = [
  "full_name",
  "email",
  "phone",
  "property_address",
  "property_city",
  "property_state",
  "property_zip",
  "property_type",
  "property_condition",
  "estimated_repairs",
  "reason_for_selling",
  "desired_timeline",
  "mortgage_status",
  "notes",
  "lead_source",
  "status",
  "pipeline_stage",
] as const;

export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  full_name: "Owner / Contact Name",
  email: "Email",
  phone: "Phone",
  property_address: "Property Address",
  property_city: "City",
  property_state: "State",
  property_zip: "ZIP Code",
  property_type: "Property Type",
  property_condition: "Condition",
  estimated_repairs: "Estimated Repairs",
  reason_for_selling: "Reason for Selling",
  desired_timeline: "Desired Timeline",
  mortgage_status: "Mortgage Status",
  notes: "Notes",
  lead_source: "Lead Source",
  status: "Pipeline Status",
  pipeline_stage: "Pipeline Stage",
};

// Aliases per lead field, matched against a normalized header (lowercase,
// non-alphanumerics stripped). First field whose alias list matches wins.
const FIELD_ALIASES: Record<LeadField, string[]> = {
  full_name: [
    "fullname", "ownername", "owner", "name", "sellername", "seller",
    "contactname", "propertyowner", "mailingname", "homeowner", "owner1",
    "name1", "propertyname", "primaryname",
  ],
  email: ["email", "emailaddress", "emailaddr", "email1", "primaryemail", "emailaddress1", "mail"],
  phone: [
    "phone", "phonenumber", "phone1", "primaryphone", "mobile", "cell",
    "cellphone", "telephone", "contactphone", "homephone", "homephonenumber",
    "phone1value", "phoneno",
  ],
  property_address: [
    "propertyaddress", "address", "streetaddress", "street", "siteaddress",
    "propertystreet", "mailingaddress", "address1", "situsaddress", "situs",
    "physicaladdress", "propaddress", "locationaddress",
  ],
  property_city: ["propertycity", "city", "sitecity", "propertycityname"],
  property_state: ["propertystate", "state", "st", "sitestate", "propertystatecode"],
  property_zip: [
    "propertyzip", "zip", "zipcode", "postalcode", "postal", "propertyzipcode",
    "sitezip", "zippostal", "postalzip",
  ],
  property_type: ["propertytype", "type", "proptype", "unittype", "hometype"],
  property_condition: ["propertycondition", "condition", "propcondition", "homecondition"],
  estimated_repairs: [
    "estimatedrepairs", "repairs", "repairestimate", "estimatedrepair",
    "repaircost", "repairestimate", "estrepairs",
  ],
  reason_for_selling: [
    "reasonforselling", "reason", "motivation", "motivator", "sellingreason",
    "reasonforsale", "motivationreason", "motivationlevel",
  ],
  desired_timeline: [
    "desiredtimeline", "timeline", "timeframe", "desiredtimeframe",
    "sellingtimeline", "whencanymove", "moveindate",
  ],
  mortgage_status: ["mortgagestatus", "mortgage", "loanstatus", "lienstatus", "mortgagestate"],
  notes: [
    "notes", "note", "comments", "comment", "remarks", "remark", "description",
    "additionalinfo", "additionalnotes", "extra", "extrainfo", "notes1",
  ],
  lead_source: [
    "leadsource", "source", "sourcetype", "leadsourcetype", "source1",
    "leadtype", "leadstype", "originsource",
  ],
  status: ["status", "leadstatus", "currentstatus", "pipelinestatus"],
  pipeline_stage: ["pipelinestage", "stage", "pipeline", "stagetype"],
};

const ALIAS_LOOKUP = new Map<string, LeadField>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [LeadField, string[]][]) {
  for (const alias of aliases) ALIAS_LOOKUP.set(alias, field);
}

/** Normalize a header/alias for matching: lowercase, keep letters+digits. */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Auto-detect the lead field for a CSV header. Returns the field name or null
 * when nothing matches. e.g. "Owner Name" -> full_name, "ZIP Code" -> property_zip.
 */
export function detectField(header: string): LeadField | null {
  return ALIAS_LOOKUP.get(normalizeHeader(header)) ?? null;
}

/** Map every CSV header to a lead field (null = not detected). */
export function autoDetectMapping(headers: string[]): (LeadField | null)[] {
  return headers.map((h) => detectField(h));
}

// ---------------------------------------------------------------------------
// CSV parsing — RFC-4180-ish: quoted fields, escaped quotes, embedded
// commas/newlines, CRLF, BOM, and delimiter sniffing (comma/tab/semicolon).
// ---------------------------------------------------------------------------
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function detectDelimiter(firstLine: string): string {
  const candidates = [",", "\t", ";"];
  let best = ",";
  let bestCount = -1;
  // Count occurrences outside quoted sections.
  let inQuotes = false;
  for (const d of candidates) {
    let count = 0;
    inQuotes = false;
    for (const c of firstLine) {
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n");
  if (!lines.length) return { headers: [], rows: [] };
  const delim = detectDelimiter(lines[0] ?? "");

  // Tokenize one line into cells, respecting quotes.
  function splitLine(line: string): string[] {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"' && inQuotes) {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delim && !inQuotes) {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map((cell) => cell.trim());
  }

  // If a quoted field contains a newline, the naive line split breaks it up.
  // Walk the physical lines and re-join them while inside a quoted region.
  const logical: string[] = [];
  let buffer = "";
  let inQuote = false;
  for (const line of lines) {
    if (buffer === "") buffer = line;
    else buffer += "\n" + line;
    const quoteCount = (line.match(/"/g) ?? []).length;
    if (quoteCount % 2 === 1) inQuote = !inQuote;
    if (!inQuote) {
      logical.push(buffer);
      buffer = "";
    }
  }
  if (buffer !== "") logical.push(buffer);

  const rows = logical.map(splitLine);
  const headers = (rows.shift() ?? []).map((h) => h.trim()).filter((h) => h !== "");
  // Drop trailing fully-empty rows and rows where every cell is empty.
  const data = rows.filter((r) => r.some((cell) => cell !== ""));
  return { headers, rows: data };
}

// ---------------------------------------------------------------------------
// Row building + validation
// ---------------------------------------------------------------------------
export interface ImportRow {
  /** 1-based original row number in the CSV (for error messages). */
  rowNumber: number;
  values: Partial<Record<LeadField, string>>;
  /** true when the row has no phone AND no email */
  missingContact: boolean;
  /** true when property_address is missing/blank -> cannot import */
  invalid: boolean;
  reason?: string;
}

const REQUIRED_FIELD: LeadField = "property_address";

/**
 * Convert raw CSV cells into ImportRow objects using the (possibly overridden)
 * mapping. mapping[i] is the lead field for CSV column i (null = skip column).
 */
export function buildImportRows(
  headers: string[],
  rows: string[][],
  mapping: (LeadField | null)[],
): ImportRow[] {
  return rows.map((cells, idx) => {
    const values: Partial<Record<LeadField, string>> = {};
    headers.forEach((_, colIdx) => {
      const field = mapping[colIdx];
      if (!field) return;
      const raw = (cells[colIdx] ?? "").trim();
      // First non-empty value wins when two CSV columns map to the same field.
      if (raw !== "" && values[field] === undefined) values[field] = raw;
    });
    const address = (values[REQUIRED_FIELD] ?? "").trim();
    const phone = (values.phone ?? "").trim();
    const email = (values.email ?? "").trim();
    const invalid = address === "";
    return {
      rowNumber: idx + 2, // +2: 1 for header, 1 for zero-index
      values,
      missingContact: !invalid && (phone === "" || email === ""),
      invalid,
      reason: invalid ? "missing property address" : undefined,
    };
  });
}

/** Normalize a value for duplicate comparison. */
export function norm(v: string | undefined | null): string {
  return (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function dedupKey(address: string | undefined, name: string | undefined): string {
  return `${norm(address)}|${norm(name)}`;
}

// ---------------------------------------------------------------------------
// Server-side import (used by the route's server function).
// ---------------------------------------------------------------------------
export interface ImportOutcome {
  imported: number;
  skipped: number;
  invalid: number;
  warnings: number;
  errors: { row: number; reason: string }[];
}

export interface ImportOptions {
  /** override default lead_source value for imported leads */
  leadSource?: string;
  batchSize?: number;
}

const INSERT_FIELDS = [...LEAD_FIELDS] as const;

/**
 * Insert rows idempotently. Duplicates are matched on property_address +
 * full_name (normalized). Rows missing property_address are rejected. Missing
 * phone or email counts as a warning but still imports.
 *
 * `sql` is the server's neon handle; pass it in so this stays framework-agnostic
 * and unit-testable.
 */
export async function importLeadRows(
  sql: NeonQueryFunction<false, false>,
  rows: ImportRow[],
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, skipped: 0, invalid: 0, warnings: 0, errors: [] };
  const defaultLeadSource = options.leadSource ?? "csv_import";
  const batchSize = options.batchSize ?? 100;

  // Load existing keys once (cheap at this scale) so duplicate checks are O(1).
  const existing = new Set<string>();
  try {
    const rowsDb = (await sql`SELECT property_address, full_name FROM leads`) as {
      property_address: string | null;
      full_name: string | null;
    }[];
    for (const r of rowsDb) {
      existing.add(dedupKey(r.property_address ?? "", r.full_name ?? ""));
    }
  } catch {
    // If the table read fails we still try inserts; per-row guard keeps dedup.
  }

  // Validate + classify each row.
  const toInsert: { key: string; values: Partial<Record<LeadField, string>> }[] = [];
  for (const row of rows) {
    const address = (row.values.property_address ?? "").trim();
    if (row.invalid || address === "") {
      outcome.invalid++;
      outcome.errors.push({ row: row.rowNumber, reason: row.reason ?? "missing property address" });
      continue;
    }
    const key = dedupKey(address, row.values.full_name);
    if (existing.has(key)) {
      outcome.skipped++;
      continue;
    }
    existing.add(key); // also dedupes duplicates within this same import
    if (row.missingContact) outcome.warnings++;
    toInsert.push({ key, values: row.values });
  }

  // Batch multi-row inserts. Column names come only from the INSERT_FIELDS
  // whitelist; values are parameterized, so this is injection-safe.
  const cols = [...INSERT_FIELDS];
  for (let start = 0; start < toInsert.length; start += batchSize) {
    const batch = toInsert.slice(start, start + batchSize);
    const params: (string | null)[] = [];
    const valueTuples = batch.map((b) => {
      const v = b.values;
      const tuple = cols.map((field) => {
        if (field === "full_name") return v.full_name ?? "";
        if (field === "property_address") return v.property_address ?? "";
        if (field === "status") return v.status ?? "new";
        if (field === "pipeline_stage") return v.pipeline_stage ?? "new_lead";
        if (field === "lead_source") return v.lead_source ?? defaultLeadSource;
        return v[field] ?? null;
      });
      // Placeholder indices restart at $1 for each batch (params is empty at
      // batch start): element i of the k-th tuple in this batch is
      // $((k * cols.length) + i + 1) = $(params.length + i + 1).
      // NOTE: the "$" must be a string literal — a template interpolation
      // alone produces the bare number and the proxy sees 0 placeholders.
      params.push(...tuple);
      return "(" + tuple.map((_, i) => "$" + (params.length - tuple.length + i + 1)).join(",") + ")";
    });
    const insertCols = cols.map((c) => `"${c}"`).join(", ");
    await sql.query(
      `INSERT INTO leads (${insertCols}) VALUES ${valueTuples.join(", ")}`,
      params,
    );
    outcome.imported += batch.length;
  }
  // Audit trail for bulk CSV imports (audit §10 gap 1): the 7,150-lead history
  // had no import trail. One row per run, channel 'import' (free-text per the
  // schema — house style casts free-text channels). Dynamic import keeps this
  // lib out of the client bundle; logOutreachAudit swallows its own errors.
  try {
    const { logOutreachAudit } = await import("~/lib/compliance");
    await logOutreachAudit({
      channel: "import" as unknown as Parameters<
        typeof logOutreachAudit
      >[0]["channel"],
      direction: "internal" as unknown as Parameters<
        typeof logOutreachAudit
      >[0]["direction"],
      status: "completed" as unknown as Parameters<
        typeof logOutreachAudit
      >[0]["status"],
      reason: `Bulk lead CSV import: ${outcome.imported} imported, ${outcome.skipped} skipped (duplicate), ${outcome.invalid} invalid, ${outcome.warnings} missing-contact warning(s), ${outcome.errors.length} row error(s). Source=${defaultLeadSource}.`,
      operator: "importLeadRows",
    } as unknown as Parameters<typeof logOutreachAudit>[0]);
  } catch {
    // audit must never break the import
  }

  return outcome;
}

/** Convenience: import a full parsed CSV in one call (used by tests/scripts). */
export async function importParsedCsv(
  sql: NeonQueryFunction<false, false>,
  parsed: ParsedCsv,
  mapping: (LeadField | null)[],
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const rows = buildImportRows(parsed.headers, parsed.rows, mapping);
  return importLeadRows(sql, rows, options);
}
