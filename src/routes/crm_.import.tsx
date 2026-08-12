// /crm/import — CSV lead import page.
//
// Upload a CSV, auto-map its columns to lead DB fields (with manual override),
// preview the first rows, then import idempotently: rows already in the DB
// (matched on property_address + full_name) are skipped, rows without a
// property address are rejected, rows missing phone/email import with a warning.
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  LEAD_FIELDS,
  LEAD_FIELD_LABELS,
  autoDetectMapping,
  buildImportRows,
  detectField,
  parseCsv,
  type ImportOutcome,
  type ImportRow,
  type LeadField,
  type ParsedCsv,
} from "~/lib/lead-import";

const CHUNK_SIZE = 100;
const PREVIEW_ROWS = 10;

// --- Server function: import one chunk of rows (progress is driven client-side
// by looping over chunks; each chunk returns authoritative counts). ---
const importLeadsBatch = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { rows: ImportRow[] })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const { importLeadRows } = await import("~/lib/lead-import");
      return await importLeadRows(sql, data.rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      return {
        imported: 0,
        skipped: 0,
        invalid: 0,
        warnings: 0,
        errors: [{ row: 0, reason: msg }],
      } satisfies ImportOutcome;
    }
  });

const emptyOutcome = (): ImportOutcome => ({
  imported: 0,
  skipped: 0,
  invalid: 0,
  warnings: 0,
  errors: [],
});

export const Route = createFileRoute("/crm_/import")({
  component: ImportPage,
  head: () => ({
    meta: [
      { title: "Import Leads — DealForge Properties CRM" },
      { name: "description", content: "Import seller leads from a CSV file into the DealForge Properties CRM." },
    ],
  }),
});

function ImportPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<(LeadField | null)[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoDetected = useMemo(() => {
    if (!parsed) return [] as boolean[];
    return parsed.headers.map((h, i) => mapping[i] != null && mapping[i] === detectField(h));
  }, [parsed, mapping]);

  const addressMapped = useMemo(
    () => parsed != null && mapping.some((m) => m === "property_address"),
    [parsed, mapping],
  );

  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const text = await file.text();
      const p = parseCsv(text);
      if (!p.headers.length) {
        setError("This file doesn't look like a CSV — no header row was found.");
        setParsed(null);
        setMapping([]);
        return;
      }
      if (!p.rows.length) {
        setError("The CSV has a header row but no data rows to import.");
        setParsed(null);
        setMapping([]);
        return;
      }
      setFileName(file.name);
      setParsed(p);
      setMapping(autoDetectMapping(p.headers));
    } catch (e) {
      setError(`Could not read the file: ${e instanceof Error ? e.message : "unknown error"}`);
      setParsed(null);
      setMapping([]);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  const setMappingFor = (headerIndex: number, field: LeadField | null) => {
    setMapping((prev) => {
      const next = [...prev];
      next[headerIndex] = field;
      return next;
    });
    setResult(null);
  };

  const runImport = async () => {
    if (!parsed || !addressMapped) return;
    const rows = buildImportRows(parsed.headers, parsed.rows, mapping);
    if (!rows.length) return;
    setImporting(true);
    setError(null);
    setResult(null);
    const acc = emptyOutcome();
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const res = await importLeadsBatch({ data: { rows: chunk } });
        acc.imported += res.imported;
        acc.skipped += res.skipped;
        acc.invalid += res.invalid;
        acc.warnings += res.warnings;
        acc.errors.push(...res.errors);
        setProgress({ done: Math.min(i + chunk.length, rows.length), total: rows.length });
      }
      setResult(acc);
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const downloadSample = () => {
    const sample =
      "full_name,property_address,property_city,property_state,property_zip,phone,email,source_type,notes\n" +
      "John Doe,\"123 Main St\",San Antonio,TX,78201,(210) 555-1234,john.doe@email.com,tax-delinquent,\"Tax bill unpaid since 2024\"\n" +
      "Jane Smith,\"456 Oak Ave\",San Antonio,TX,78205,,jane.smith@email.com,pre-foreclosure,\n";
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dealflow-lead-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const startOver = () => {
    setParsed(null);
    setMapping([]);
    setFileName(null);
    setResult(null);
    setError(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-dvh">
      {/* Page Header */}
      <div className="border-b border-navy-700 bg-navy-800/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link to="/crm" className="text-sm font-medium text-gold-400 hover:text-gold-300">
                ← Back to CRM Pipeline
              </Link>
              <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Import Leads</h1>
              <p className="mt-1 text-gray-400">
                Upload a CSV, map its columns, and add every row to the pipeline in one go.
              </p>
            </div>
            <button
              onClick={downloadSample}
              className="rounded-lg border border-navy-700 bg-navy-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gold-500/40 hover:text-white"
            >
              Download sample CSV
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Step 1 — Upload */}
        {!parsed && (
          <section className="rounded-2xl border border-navy-700 bg-navy-800/50 p-6">
            <h2 className="text-lg font-semibold text-white">1. Upload your CSV</h2>
            <p className="mt-1 text-sm text-gray-400">
              Any CSV of seller leads works — tax records, pre-foreclosure lists, code violations, your
              own exports. We&apos;ll auto-detect the columns next.
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                dragOver
                  ? "border-gold-500 bg-gold-500/10"
                  : "border-navy-700 bg-navy-900/50 hover:border-gold-500/50"
              }`}
            >
              <svg className="mb-3 h-10 w-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6h.1a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm font-medium text-gray-300">
                Drag &amp; drop your CSV here, or <span className="text-gold-400">browse files</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">.csv files up to a few MB — columns like Owner Name, Property Address, City, ZIP are recognized automatically</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </section>
        )}

        {/* Step 2 — Mapping + preview + import */}
        {parsed && (
          <>
            <section className="rounded-2xl border border-navy-700 bg-navy-800/50 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">2. Map columns</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    <span className="font-medium text-gray-200">{fileName}</span> —{" "}
                    {parsed.rows.length} row{parsed.rows.length !== 1 ? "s" : ""}, {parsed.headers.length} column
                    {parsed.headers.length !== 1 ? "s" : ""}. Auto-detected columns are pre-filled — override any of them.
                  </p>
                </div>
                <button
                  onClick={startOver}
                  className="rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm font-medium text-gray-300 hover:text-white"
                >
                  Start over
                </button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-navy-700">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-navy-700 bg-navy-900/60 text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-4 py-3 font-medium">CSV Column</th>
                      <th className="px-4 py-3 font-medium">Sample Value</th>
                      <th className="px-4 py-3 font-medium">Maps To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((header, i) => (
                      <tr key={i} className="border-b border-navy-700/60 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-200">{header}</span>
                            {autoDetected[i] && (
                              <span className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-300">
                                auto
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[260px] truncate px-4 py-2.5 text-gray-400">
                          {parsed.rows[0]?.[i] || <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={mapping[i] ?? ""}
                            onChange={(e) =>
                              setMappingFor(i, (e.target.value || null) as LeadField | null)
                            }
                            className="w-full max-w-xs rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-gray-200 outline-none focus:border-gold-500/50"
                          >
                            <option value="">Do not import</option>
                            {LEAD_FIELDS.map((f) => (
                              <option key={f} value={f}>
                                {LEAD_FIELD_LABELS[f]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!addressMapped && (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                  Map at least one column to <span className="font-semibold">Property Address</span> to import —
                  it&apos;s the required field.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-navy-700 bg-navy-800/50 p-6">
              <h2 className="text-lg font-semibold text-white">3. Preview</h2>
              <p className="mt-1 text-sm text-gray-400">
                First {Math.min(PREVIEW_ROWS, parsed.rows.length)} of {parsed.rows.length} rows.
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-navy-700">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-navy-700 bg-navy-900/60 text-xs uppercase tracking-wide text-gray-400">
                      {parsed.headers.map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                      <tr key={ri} className="border-b border-navy-700/60 last:border-0">
                        {parsed.headers.map((_, ci) => (
                          <td key={ci} className="max-w-[200px] truncate px-4 py-2 text-gray-300">
                            {row[ci] || <span className="text-gray-600">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Step 4 — Import */}
            <section className="rounded-2xl border border-navy-700 bg-navy-800/50 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">4. Import</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    New leads get status <span className="text-gray-200">new</span>, source{" "}
                    <span className="text-gray-200">csv_import</span>, and stage{" "}
                    <span className="text-gray-200">new_lead</span>. Rows that already exist (same
                    address + owner) are skipped.
                  </p>
                </div>
                <button
                  onClick={runImport}
                  disabled={importing || !addressMapped}
                  className="rounded-lg bg-gold-500 px-6 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? "Importing…" : `Import ${parsed.rows.length} lead${parsed.rows.length !== 1 ? "s" : ""}`}
                </button>
              </div>

              {importing && progress && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>
                      Processing row {Math.min(progress.done, progress.total)} of {progress.total}
                    </span>
                    <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-navy-900">
                    <div
                      className="h-full rounded-full bg-gold-500 transition-all duration-200"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              )}

              {result && (
                <div className="mt-4 rounded-xl border border-navy-700 bg-navy-900/60 p-5">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Import complete
                  </h3>
                  <p className="mt-2 text-sm text-gray-300">
                    <span className="font-semibold text-green-400">Imported {result.imported} lead{result.imported !== 1 ? "s" : ""}.</span>{" "}
                    {result.skipped > 0 && (
                      <span className="font-semibold text-amber-400">Skipped {result.skipped} duplicate{result.skipped !== 1 ? "s" : ""}.</span>
                    )}{" "}
                    {result.warnings > 0 && (
                      <span className="font-semibold text-amber-300">{result.warnings} row{result.warnings !== 1 ? "s" : ""} had warnings.</span>
                    )}{" "}
                    {result.invalid > 0 && (
                      <span className="font-semibold text-red-400">{result.invalid} row{result.invalid !== 1 ? "s" : ""} skipped (missing property address).</span>
                    )}
                  </p>
                  {result.warnings > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      Warning rows are missing a phone number or email address — they were imported
                      anyway and can be enriched later from the CRM.
                    </p>
                  )}
                  {result.errors.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-red-400">
                      {result.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>
                          Row {e.row}: {e.reason}
                        </li>
                      ))}
                      {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
                    </ul>
                  )}
                  <div className="mt-4 flex gap-3">
                    <Link
                      to="/crm"
                      className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400"
                    >
                      View CRM Pipeline →
                    </Link>
                    <button
                      onClick={startOver}
                      className="rounded-lg border border-navy-700 px-4 py-2 text-sm font-medium text-gray-300 hover:text-white"
                    >
                      Import another file
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
