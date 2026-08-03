import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useRef } from "react";
import pdfParse from "pdf-parse";
import { explainEstimate as callAI, MissingApiKeyError, RateLimitError } from "~/ai";
import { sql } from "~/db";
import { getSessionFromRequest } from "~/auth";
import { getStartContext } from "@tanstack/start-storage-context";

/* ── Sample estimate text ────────────────────────────────────────── */
const SAMPLE_ESTIMATE = `R&I Front Bumper Assembly - 2.5 hrs
Replace Left Fender (OEM) - 3.0 hrs
Feather/Block & Prime Left Fender - 1.5 hrs
Blend Left Front Door - 2.0 hrs
Clear Coat Application - 1.0 hr`;

/* ── Server function (real AI) ───────────────────────────────────── */
const explainEstimate = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null || !("estimate" in data)) {
      throw new Error("Estimate text is required");
    }
    const { estimate } = data as { estimate: string };
    if (!estimate || !estimate.trim()) {
      throw new Error("Estimate text is required");
    }
    return { estimate: estimate.trim() };
  })
  .handler(async ({ data }) => {
    // Get the authenticated user (if any) for saving to DB
    let userId: number | null = null;
    try {
      const startCtx = getStartContext();
      if (startCtx?.request) {
        const session = getSessionFromRequest(startCtx.request);
        if (session) {
          userId = session.userId;
        }
      }
    } catch {
      // Non-authenticated usage is fine — just won't save to DB
    }

    try {
      const explanation = await callAI(data.estimate);

      // Save to estimates table if user is authenticated
      if (userId) {
        try {
          await sql`
            INSERT INTO estimates (user_id, original_text, explanation)
            VALUES (${userId}, ${data.estimate}, ${explanation})
          `;
        } catch (dbErr: any) {
          console.error("Failed to save estimate to DB:", dbErr?.message || dbErr);
          // Non-fatal — still return the explanation
        }
      }

      return { explanation };
    } catch (err: any) {
      console.error("Estimate Explainer AI error:", err?.message || err);

      if (err instanceof MissingApiKeyError) {
        return {
          error:
            "API key not configured. Please set the ANTHROPIC_API_KEY environment variable to enable estimate explanations.",
        };
      }

      if (err instanceof RateLimitError) {
        return {
          error:
            "We're receiving too many requests right now. Please wait a moment and try again.",
        };
      }

      return {
        error:
          "We couldn't translate this estimate right now. Please try again.",
      };
    }
  });

/* ── PDF server function ─────────────────────────────────────────── */
const explainPdfEstimate = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null || !("pdfBase64" in data)) {
      throw new Error("PDF file is required");
    }
    const { pdfBase64 } = data as { pdfBase64: string };
    if (!pdfBase64 || typeof pdfBase64 !== "string") throw new Error("PDF file is required");
    if (pdfBase64.length > 14_000_000) throw new Error("PDF file is too large (maximum 10MB)");
    return { pdfBase64 };
  })
  .handler(async ({ data }) => {
    try {
      const buffer = Buffer.from(data.pdfBase64, "base64");
      if (buffer.subarray(0, 5).toString() !== "%PDF-") return { error: "This file doesn't appear to be a valid PDF." };
      const parsed = await pdfParse(buffer);
      const text = parsed.text?.trim();
      if (!text) return { error: "We couldn't extract text from this PDF. It may be a scanned image." };
      const explanation = await callAI(text);
      let userId: number | null = null;
      try {
        const ctx = getStartContext();
        if (ctx?.request) { const session = getSessionFromRequest(ctx.request); if (session) userId = session.userId; }
      } catch { /* anonymous uploads are allowed */ }
      if (userId) {
        try { await sql`INSERT INTO estimates (user_id, original_text, explanation) VALUES (${userId}, ${text}, ${explanation})`; }
        catch (dbErr) { console.error("Failed to save PDF estimate:", dbErr); }
      }
      return { explanation, extractedText: text };
    } catch (err: any) {
      const message = String(err?.message || "").toLowerCase();
      if (message.includes("password") || message.includes("encrypted")) return { error: "This PDF is password protected. Please upload an unlocked copy." };
      if (err instanceof MissingApiKeyError) return { error: "API key not configured. Please set the ANTHROPIC_API_KEY environment variable to enable estimate explanations." };
      if (err instanceof RateLimitError) return { error: "We're receiving too many requests right now. Please wait a moment and try again." };
      console.error("PDF estimate extraction error:", err);
      return { error: "We couldn't read this PDF. Please make sure it isn't corrupted and try again." };
    }
  });

/* ── Page route ──────────────────────────────────────────────────── */
export const Route = createFileRoute("/dashboard/estimate-explainer")({
  component: EstimateExplainerPage,
});

/* ── Types ───────────────────────────────────────────────────────── */
type Status = "idle" | "loading" | "success" | "error";

interface ExplanationResult {
  explanation: string;
}

/* ── Page component ──────────────────────────────────────────────── */
function EstimateExplainerPage() {
  const [estimate, setEstimate] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "pdf">("text");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePdfFile = useCallback(async (file: File) => {
    setPdfError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setPdfError("Please choose a PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setPdfError("This PDF is too large. Please choose a file under 10MB."); return; }
    setSelectedFile(file.name); setStatus("loading"); setResult(null); setErrorMsg("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ""; const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const data = await explainPdfEstimate({ data: { pdfBase64: btoa(binary) } });
      if ("error" in data) { setPdfError(data.error); setStatus("idle"); return; }
      setEstimate(data.extractedText); setStatus("idle");
    } catch { setPdfError("We couldn't read this PDF. Please make sure it isn't corrupted and try again."); setStatus("idle"); }
  }, []);

  const removePdf = useCallback(() => { setSelectedFile(null); setPdfError(""); setEstimate(""); if (fileInputRef.current) fileInputRef.current.value = ""; }, []);

  const handleExplain = useCallback(async () => {
    if (!estimate.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    setCopied(false);

    try {
      const data = await explainEstimate({ data: { estimate } });
      if ("error" in data) {
        setStatus("error");
        setErrorMsg(data.error);
      } else {
        setResult(data);
        setStatus("success");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg("We couldn't translate this estimate right now. Please try again.");
    }
  }, [estimate]);

  const handleSample = useCallback(() => {
    setEstimate(SAMPLE_ESTIMATE);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  }, []);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const text = result.explanation;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter to trigger explain
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleExplain();
    }
  };

  const isEmpty = !estimate.trim();
  const isLoading = status === "loading";

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* ── Left column: Input ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-white sm:text-2xl">
            {inputMode === "pdf" ? "Upload an Estimate" : "Paste an Estimate"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Paste any repair estimate below and we'll translate it into plain
            English your customers will understand.
          </p>
        </div>

        {/* Input mode switch and PDF uploader */}
        <div className="mb-4 flex rounded-lg border border-slate-700 bg-slate-800/60 p-1">
          {(["text", "pdf"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => { setInputMode(mode); setPdfError(""); }} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${inputMode === mode ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"}`}>
              {mode === "text" ? "Paste Text" : "Upload PDF"}
            </button>
          ))}
        </div>
        {inputMode === "pdf" && (
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handlePdfFile(file); }} onClick={() => !selectedFile && fileInputRef.current?.click()} className={`mb-4 rounded-xl border border-dashed ${pdfError ? "border-red-500/60" : "border-slate-600 hover:border-orange-500"} bg-slate-800/50 p-5 text-center transition ${!selectedFile ? "cursor-pointer" : ""}`}>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePdfFile(file); }} />
            {selectedFile ? <div className="flex items-center justify-center gap-3 text-sm text-slate-200"><span>📄 {selectedFile}</span><button type="button" onClick={(e) => { e.stopPropagation(); removePdf(); }} className="text-orange-400 hover:text-orange-300 underline">Remove</button></div> : <><div className="text-2xl mb-1">📎</div><p className="text-sm text-slate-300">Drop a PDF estimate here — or click to browse</p><p className="mt-1 text-xs text-slate-500">PDF files up to 10MB</p></>}
            {pdfError && <p className="mt-3 text-sm text-red-400">{pdfError}</p>}
          </div>
        )}

        {/* Textarea */}
        <textarea
          value={estimate}
          onChange={(e) => {
            setEstimate(e.target.value);
            if (status === "success" || status === "error") setStatus("idle");
          }}
          onKeyDown={handleKeyDown}
          placeholder={SAMPLE_ESTIMATE}
          rows={12}
          className="w-full flex-1 min-h-[300px] rounded-xl border border-slate-600 bg-slate-800 px-4 py-3.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-y font-mono leading-relaxed"
        />

        {/* Sample link */}
        <div className="mt-2">
          <button
            type="button"
            onClick={handleSample}
            className="text-sm text-orange-400 hover:text-orange-300 transition underline underline-offset-2"
          >
            Try with a sample estimate
          </button>
        </div>

        {/* Explain button */}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleExplain}
            disabled={isEmpty || isLoading}
            title={isEmpty ? "Paste an estimate first" : undefined}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isLoading ? (
              <>
                <Spinner />
                Translating...
              </>
            ) : (
              "Explain This Estimate"
            )}
          </button>
        </div>

        {/* Error state */}
        {status === "error" && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-400">{errorMsg}</p>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <p className="mt-2 text-xs text-slate-600">
          Tip: Press ⌘+Enter to explain
        </p>
      </div>

      {/* ── Right column: Output ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-white sm:text-2xl">
            Plain-English Explanation
          </h2>
        </div>

        {/* Empty state */}
        {status === "idle" && !result && (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/30 p-10 text-center">
            <div className="text-5xl mb-4 opacity-40">📄</div>
            <p className="text-slate-400 text-sm max-w-xs">
              Your plain-English explanation will appear here
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 space-y-5 animate-pulse">
            <div className="h-5 bg-slate-700 rounded w-2/3" />
            <div className="space-y-3">
              <div className="h-4 bg-slate-700 rounded w-full" />
              <div className="h-4 bg-slate-700 rounded w-5/6" />
              <div className="h-4 bg-slate-700 rounded w-4/6" />
            </div>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-2 w-2 mt-2 rounded-full bg-slate-700 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 bg-slate-700 rounded w-1/3" />
                    <div className="h-3 bg-slate-700 rounded w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success: explanation result */}
        {status === "success" && result && (
          <div className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 sm:p-6 overflow-y-auto">
            <MarkdownBlock content={result.explanation} />

            {/* Copy button */}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-500 transition"
              >
                {copied ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-emerald-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy explanation
                  </>
                )}
              </button>
            </div>

            {/* Disclaimer */}
            <p className="mt-4 text-xs text-slate-600 leading-relaxed">
              This explanation is AI-generated. A technician reviews all
              estimates before they're shared with customers.
            </p>
          </div>
        )}

        {/* Error: fallback empty state (shouldn't normally show here) */}
        {status === "error" && !result && (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/30 p-10 text-center">
            <div className="text-5xl mb-4 opacity-40">⚠️</div>
            <p className="text-slate-400 text-sm max-w-xs">
              Something went wrong generating your explanation. Please try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Markdown renderer ────────────────────────────────────────────── */
function MarkdownBlock({ content }: { content: string }) {
  // Split into sections by ### headings
  const sections = content.split(/(?=^### )/m);

  return (
    <div className="space-y-5">
      {sections.map((section, si) => {
        const lines = section.split("\n");
        const headingLine = lines[0];
        const bodyLines = lines.slice(1);

        // Extract heading text (strip ### and leading/trailing whitespace)
        const heading = headingLine.replace(/^###\s*/, "").trim();

        return (
          <div key={si}>
            {heading && (
              <h3 className="text-base font-bold text-white mb-2">
                {heading}
              </h3>
            )}
            <div className="space-y-2">
              {bodyLines.map((line, li) => {
                const trimmed = line.trim();
                if (!trimmed) return null;

                // Bullet point
                if (trimmed.startsWith("- ")) {
                  const bulletContent = trimmed.slice(2);
                  return (
                    <div
                      key={li}
                      className="flex items-start gap-3 pl-1"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {renderInlineMarkdown(bulletContent)}
                      </p>
                    </div>
                  );
                }

                // Regular paragraph
                return (
                  <p
                    key={li}
                    className="text-sm text-slate-300 leading-relaxed"
                  >
                    {renderInlineMarkdown(trimmed)}
                  </p>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Inline markdown (bold, italic) ───────────────────────────────── */
function renderInlineMarkdown(text: string): React.ReactNode {
  // Split by **bold** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/* ── Spinner component ───────────────────────────────────────────── */
function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
