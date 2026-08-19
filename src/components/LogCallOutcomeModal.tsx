// DealFlow AI — Log Call Outcome modal (D2 Seller Conversation Engine)
//
// The owner input surface: after a manual call, the owner picks an outcome
// from the state-machine vocabulary, writes a free-text summary, and confirms
// structured seller fields. Submit calls the D2 engine (server fn) which
// advances the lead, persists fields, schedules follow-ups, hard-suppresses on
// opt-out, and writes the audit trail.
//
// NO AI IS CLAIMED. The "assisted prefill" button runs a deterministic keyword
// heuristic over the summary and is labeled "assisted (heuristic)" — it only
// prefills fields the owner confirms before saving. No LLM is connected.
import { useState } from "react";
import {
  CALL_OUTCOME_OPTIONS,
  getCallOutcomeOption,
  extractSellerHints,
  type CallOutcomeValue,
} from "~/lib/call-outcome-vocab";
import type { LogCallOutcomeResult } from "~/lib/log-call-outcome";

export interface LogCallLead {
  id: string;
  full_name: string | null;
  phone: string | null;
  property_address: string | null;
  property_city: string | null;
}

export type LogCallSubmit = (
  leadId: string,
  input: Record<string, unknown>,
) => Promise<LogCallOutcomeResult>;

const inputCls =
  "w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400";

const fmtPhone = (p: string | null): string => {
  if (!p) return "—";
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

export function LogCallOutcomeModal({
  lead,
  onSubmit,
  onClose,
}: {
  lead: LogCallLead;
  onSubmit: LogCallSubmit;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcomeValue>("connected");
  const [summary, setSummary] = useState("");
  // structured fields
  const [askingPrice, setAskingPrice] = useState("");
  const [desiredClose, setDesiredClose] = useState("");
  const [condition, setCondition] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [motivation, setMotivation] = useState("");
  const [mortgageBalance, setMortgageBalance] = useState("");
  const [mortgageLender, setMortgageLender] = useState("");
  const [lienInfo, setLienInfo] = useState("");
  const [decisionMakers, setDecisionMakers] = useState("");
  const [dealPotential, setDealPotential] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDue, setNextActionDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LogCallOutcomeResult | null>(null);
  const [hintNotice, setHintNotice] = useState(false);

  const opt = getCallOutcomeOption(outcome);

  const applyHints = () => {
    const h = extractSellerHints(summary);
    if (h.askingPrice != null) setAskingPrice(String(h.askingPrice));
    if (h.desiredClose != null) setDesiredClose(h.desiredClose);
    if (h.occupancy) setOccupancy(h.occupancy);
    if (h.condition) setCondition(h.condition);
    if (h.mortgageBalance != null) setMortgageBalance(String(h.mortgageBalance));
    if (h.motivation) setMotivation(h.motivation);
    setHintNotice(true);
  };

  const buildInput = (): Record<string, unknown> => {
    const put = (k: string, v: string) => (v.trim() !== "" ? { ...{}, [k]: v } : {});
    const i: Record<string, unknown> = { outcome };
    if (summary.trim()) i.sellerSummary = summary;
    if (askingPrice.trim()) i.askingPrice = Number(askingPrice);
    if (desiredClose.trim()) i.desiredClose = desiredClose;
    if (condition.trim()) i.propertyCondition = condition;
    if (occupancy) i.occupancy = occupancy;
    if (motivation.trim()) i.motivation = motivation;
    if (mortgageBalance.trim()) i.mortgageBalance = Number(mortgageBalance);
    if (mortgageLender.trim()) i.mortgageLender = mortgageLender;
    if (lienInfo.trim()) i.lienInfo = lienInfo;
    if (decisionMakers.trim()) i.decisionMakers = decisionMakers;
    if (dealPotential) i.dealPotential = dealPotential;
    if (nextAction.trim()) i.nextAction = nextAction;
    if (nextActionDue.trim()) i.nextActionDue = nextActionDue;
    return i;
  };

  const handleSubmit = async () => {
    setBusy(true);
    setHintNotice(false);
    const res = await onSubmit(lead.id, buildInput());
    setResult(res);
    setBusy(false);
  };

  const terminal = opt?.terminal;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-navy-700 bg-navy-800 shadow-2xl">
        <div className="flex items-start justify-between border-b border-navy-700 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Log call outcome</h2>
            <p className="mt-1 text-sm text-gray-400">
              {lead.full_name ?? "—"} · {fmtPhone(lead.phone)} · {lead.property_address ? `${lead.property_address}${lead.property_city ? `, ${lead.property_city}` : ""}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-500">Records what happened on your manual call — never sends anything.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-white" aria-label="Close">✕</button>
        </div>

        <div className="space-y-5 p-5">
          {/* Outcome */}
          <div>
            <label className={labelCls}>Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcomeValue)} className={inputCls}>
              <optgroup label="Contact outcomes">
                {CALL_OUTCOME_OPTIONS.filter((o) => !o.terminal).map((o) => (
                  <option key={o.value} value={o.value}>{o.label} → {o.toStatus}</option>
                ))}
              </optgroup>
              <optgroup label="Terminal / suppression">
                {CALL_OUTCOME_OPTIONS.filter((o) => o.terminal).map((o) => (
                  <option key={o.value} value={o.value}>{o.label} → {o.toStatus}</option>
                ))}
              </optgroup>
            </select>
            {opt && <p className="mt-1 text-xs text-gray-500">{opt.description}</p>}
            {terminal && (
              <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                ⚠ This outcome closes the lead: {opt?.suppression || opt?.toStatus}. It will hard-suppress / absorb the lead (status {opt?.toStatus}) and refuse further outreach, writing an audit + consent record.
              </p>
            )}
          </div>

          {/* Summary + assisted prefill */}
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>Seller summary (notes)</label>
              <button
                type="button"
                onClick={applyHints}
                disabled={!summary.trim()}
                className="text-xs font-medium text-gold-400 hover:underline disabled:opacity-40"
              >
                Assisted prefill (heuristic, not AI)
              </button>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="e.g. Owner is motivated, asking 250k, vacant, wants to close in 45 days, mortgage owed 160k"
              className={inputCls}
            />
            {hintNotice && (
              <p className="mt-1 text-xs text-gold-400">
                Prefilled from a keyword heuristic — review and correct before saving. No AI is connected.
              </p>
            )}
          </div>

          {/* Structured seller fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Asking price ($)</label>
              <input value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Desired close</label>
              <input type="date" value={desiredClose} onChange={(e) => setDesiredClose(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Property condition</label>
              <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="fair / poor / needs work" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Occupancy</label>
              <select value={occupancy} onChange={(e) => setOccupancy(e.target.value)} className={inputCls}>
                <option value="">— not recorded —</option>
                <option value="owner">Owner-occupied</option>
                <option value="tenant">Tenant</option>
                <option value="vacant">Vacant</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Reason for selling</label>
              <input value={motivation} onChange={(e) => setMotivation(e.target.value)} placeholder="downsizing / relocation / …" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Mortgage balance ($)</label>
              <input value={mortgageBalance} onChange={(e) => setMortgageBalance(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Mortgage lender</label>
              <input value={mortgageLender} onChange={(e) => setMortgageLender(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Liens / encumbrances</label>
              <input value={lienInfo} onChange={(e) => setLienInfo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Decision-makers</label>
              <input value={decisionMakers} onChange={(e) => setDecisionMakers(e.target.value)} placeholder="Maria + spouse, co-owner" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Deal potential</label>
              <select value={dealPotential} onChange={(e) => setDealPotential(e.target.value)} className={inputCls}>
                <option value="">— not assessed —</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Next action</label>
              <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Send offer / call back" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Next action due</label>
              <input type="date" value={nextActionDue} onChange={(e) => setNextActionDue(e.target.value)} className={inputCls} />
              {(outcome === "no_answer" || outcome === "call_back") && (
                <p className="mt-1 text-xs text-gray-500">Leave blank to auto-schedule a 7-day call-back.</p>
              )}
            </div>
          </div>

          {/* Result / submit */}
          {result && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${result.success ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
              {result.success ? (
                <>
                  <div className="font-medium">Saved. Status → <span className="font-semibold">{result.status}</span>
                    {result.transitions && result.transitions.length > 0 && (
                      <span className="font-normal text-gray-400"> (via {result.transitions.map((t) => `${t.from}→${t.to}`).join(", ")})</span>
                    )}
                  </div>
                  {result.suppressionApplied && <div className="mt-1 text-xs">Hard suppression engaged — further outreach refused.</div>}
                  {result.nextActionDue && <div className="mt-1 text-xs">Follow-up scheduled: {result.nextAction ? `${result.nextAction} — ` : ""}due {result.nextActionDue}.</div>}
                  {result.sellerSummary && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-navy-900 p-2 text-xs text-gray-300">{result.sellerSummary}</pre>}
                </>
              ) : (
                <div>{result.error}</div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="rounded-lg border border-navy-600 px-4 py-2 text-sm text-gray-300 hover:bg-navy-900">
              Close
            </button>
            {!result?.success && (
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-50"
              >
                {busy ? "Saving…" : terminal ? "Log & suppress" : "Log outcome"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
