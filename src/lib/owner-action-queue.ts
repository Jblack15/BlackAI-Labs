// DealFlow AI — Owner Action Queue (D1, central AI Ops Manager read surface)
//
// This is the "what needs the owner today" operating screen, composed at READ
// time from existing libs and tables — no new tables, no duplicated business
// logic. Every number traces to real rows; empty = empty (an honest zero,
// never a decorated fake).
//
// Sections (each maps to an existing owned source):
//   1. needsApproval   → approvals.pendingApprovals() (offers/contracts/
//                        assignments/spend/campaign_change still awaiting the
//                        owner's decision).
//   2. callNow         → prioritization.next25ToWork() (top priority leads,
//                        filtered to those actually callable) + any due
//                        follow-ups (next_action_due <= today, contactable,
//                        not suppressed). Manual-call framing: voice is the
//                        owner's call; there is no dialer.
//   3. attention       → command-center.attentionItems() (stalled trace jobs,
//                        stuck contacts, trace gaps, suppression, buy-box
//                        verification, campaign gates).
//   4. traceGaps       → leads that are TRACED but NOT contactable (the
//                        DNC-only rows that legitimately have no usable
//                        phone).
//   5. queue           → prioritization.queueDistribution() (HOT/HIGH/...).
//   6. counts          → top-level totals (leads, traced, contactable,
//                        with-phone) from the live tables.
//
// This slice is deliberately READ-ONLY composition. The follow-on D2 slice
// adds the conversation engine / posting of actions; nothing here writes.

import type { ApprovalRow } from "./approvals";
import type { Next25Lead } from "./prioritization";
import type { AttentionItem } from "./command-center";

export interface CallNowLead extends Next25Lead {
  rank: number;
  callable: boolean;
  suppressed: boolean;
  premium: boolean;
}

export interface OperationsOverview {
  generatedAt: string;
  needsApproval: ApprovalRow[];
  needsApprovalCount: number;
  callNow: CallNowLead[];
  callNowCount: number;
  dueFollowUps: CallNowLead[];
  attention: AttentionItem[];
  traceGaps: { count: number; leads: { full_name: string; property_address: string; dnc_flag: string | null }[] };
  queue: { queue: string; count: number }[];
  counts: {
    totalLeads: number;
    traced: number;
    contactable: number;
    withPhone: number;
    hot: number;
  };
}

/** Suppressed = any of the hard suppression flags or opted-out. */
function isSuppressed(f: {
  dnc_flag?: string | null;
  do_not_mail?: boolean | null;
  opted_out?: boolean | null;
  invalid_contact?: boolean | null;
  wrong_number?: boolean | null;
}): boolean {
  const dnc = (f.dnc_flag ?? "").toUpperCase();
  if (dnc === "DNC" || dnc === "DO_NOT_MAIL" || dnc === "OPTED_OUT" || dnc === "PUBLIC DNC") return true;
  return !!f.do_not_mail || !!f.opted_out || !!f.invalid_contact || !!f.wrong_number;
}

/**
 * Compose the full operations overview at read time. Never throws — each
 * section degrades to an honest empty/zero so a failing sub-lib cannot blank
 * the whole screen.
 */
export async function getOperationsOverview(): Promise<OperationsOverview> {
  const { sql } = await import("~/db");
  const overview: Partial<OperationsOverview> = {
    generatedAt: new Date().toISOString(),
  };

  // 1. Pending approvals.
  try {
    const { pendingApprovals } = await import("./approvals");
    const approvals = await pendingApprovals();
    overview.needsApproval = approvals;
    overview.needsApprovalCount = approvals.length;
  } catch {
    overview.needsApproval = [];
    overview.needsApprovalCount = 0;
  }

  // 2. Call-now: top-priority work list (with phones) + due follow-ups.
  const callNow: CallNowLead[] = [];
  let dueFollowUps: CallNowLead[] = [];
  try {
    const { next25ToWork } = await import("./prioritization");
    const top25 = await next25ToWork();
    // Pull suppression + premium flags for the 25 so the call list is honest.
    const ids = top25.map((t) => t.id);
    const flags = ids.length
      ? ((await sql`
          SELECT id, premium_lead, dnc_flag, do_not_mail, opted_out,
                 invalid_contact, wrong_number
          FROM leads WHERE id = ANY(${ids}::uuid[])
        `) as Array<{
          id: string;
          premium_lead: boolean | null;
          dnc_flag: string | null;
          do_not_mail: boolean | null;
          opted_out: boolean | null;
          invalid_contact: boolean | null;
          wrong_number: boolean | null;
        }>)
      : [];
    const byId = new Map(flags.map((f) => [f.id, f]));
    top25.forEach((t, i) => {
      const f = byId.get(t.id);
      callNow.push({
        ...t,
        rank: i + 1,
        callable: t.contactable,
        suppressed: isSuppressed(f ?? {}),
        premium: !!f?.premium_lead,
      });
    });

    // Due follow-ups: a next_action_due on/before today that is still
    // actionable (contactable + not suppressed + not a terminal status).
    const due = (await sql`
      SELECT id
      FROM leads
      WHERE next_action_due IS NOT NULL
        AND next_action_due <= now()
        AND contactable = true
        AND COALESCE(opted_out, false) = false
        AND COALESCE(do_not_mail, false) = false
        AND COALESCE(invalid_contact, false) = false
        AND COALESCE(wrong_number, false) = false
        AND outreach_status NOT IN ('dnc','do_not_mail','opted_out','invalid_contact','wrong_number','not_interested','dead_lead')
      ORDER BY next_action_due ASC
      LIMIT 25
    `) as { id: string }[];
    if (due.length) {
      const full = (await sql`
        SELECT id, full_name, property_address, property_city, property_state,
               property_zip, phone, email, score, priority_queue, contactable,
               outreach_status, apn, asking_price, desired_close, next_action,
               premium_lead, dnc_flag, do_not_mail, opted_out,
               invalid_contact, wrong_number, score_factors
        FROM leads WHERE id = ANY(${due.map((d) => d.id)}::uuid[])
      `) as Array<Record<string, unknown>>;
      dueFollowUps = full.map((r, i) => ({
        id: r.id as string,
        full_name: (r.full_name as string) ?? null,
        property_address: (r.property_address as string) ?? null,
        property_city: (r.property_city as string) ?? null,
        property_state: (r.property_state as string) ?? null,
        property_zip: (r.property_zip as string) ?? null,
        phone: (r.phone as string) || null,
        email: (r.email as string) || null,
        score: r.score == null ? null : Number(r.score),
        priority_queue: ((r.priority_queue as string) ?? "LOW") as Next25Lead["priority_queue"],
        contactable: !!r.contactable,
        outreach_status: (r.outreach_status as string) ?? "new",
        apn: (r.apn as string) ?? null,
        asking_price: r.asking_price == null ? null : Number(r.asking_price),
        desired_close: r.desired_close ? String(r.desired_close).slice(0, 10) : null,
        next_action: (r.next_action as string) ?? null,
        score_factors: {
          estimated_mao: r.score_factors && (r.score_factors as any).estimated_mao != null ? Number((r.score_factors as any).estimated_mao) : null,
          equity: r.score_factors && (r.score_factors as any).equity != null ? Number((r.score_factors as any).equity) : null,
          foreclosure_factor: r.score_factors && typeof (r.score_factors as any).foreclosure_factor === "string" ? (r.score_factors as any).foreclosure_factor : null,
        },
        rank: i + 1,
        callable: !!r.contactable,
        suppressed: isSuppressed(r as any),
        premium: !!r.premium_lead,
      }));
    }
  } catch {
    // callNow stays empty on failure — honest.
  }
  overview.callNow = callNow;
  overview.callNowCount = callNow.filter((c) => c.callable && !c.suppressed).length;
  overview.dueFollowUps = dueFollowUps;

  // 3. Attention items from the command center.
  try {
    const { attentionItems } = await import("./command-center");
    overview.attention = await attentionItems();
  } catch {
    overview.attention = [];
  }

  // 4. Trace gaps: TRACED but not callable (DNC-only / no usable phone).
  try {
    const gapRows = (await sql`
      SELECT full_name, property_address, dnc_flag
      FROM leads
      WHERE trace_status = 'TRACED' AND contactable = false
      ORDER BY score DESC NULLS LAST
      LIMIT 25
    `) as Array<{ full_name: string; property_address: string; dnc_flag: string | null }>;
    const gapCount = (await sql`
      SELECT COUNT(*)::int AS n FROM leads WHERE trace_status = 'TRACED' AND contactable = false
    `) as { n: number }[];
    overview.traceGaps = { count: gapCount[0]?.n ?? 0, leads: gapRows };
  } catch {
    overview.traceGaps = { count: 0, leads: [] };
  }

  // 5. Queue distribution.
  try {
    const { queueDistribution } = await import("./prioritization");
    overview.queue = await queueDistribution();
  } catch {
    overview.queue = [];
  }

  // 6. Top-level counts.
  try {
    const c = (await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE trace_status = 'TRACED')::int AS traced,
        COUNT(*) FILTER (WHERE contactable = true)::int AS contactable,
        COUNT(*) FILTER (WHERE phone IS NOT NULL AND btrim(phone) <> '')::int AS with_phone,
        COUNT(*) FILTER (WHERE priority_queue = 'HOT')::int AS hot
      FROM leads
    `) as Array<{ total: number; traced: number; contactable: number; with_phone: number; hot: number }>;
    // NOTE: assigned via the mapping block below (SQL aliases are snake_case;
    // the typed shape uses camelCase, so no direct assignment here).
    (overview as any).counts = c[0];
  } catch {
    overview.counts = { totalLeads: 0, traced: 0, contactable: 0, withPhone: 0, hot: 0 };
  }
  // Map DB column names to the typed shape (aliases can't use camelCase in SQL).
  const c = (overview as any).counts;
  if (c && c.total !== undefined) {
    overview.counts = {
      totalLeads: c.total,
      traced: c.traced,
      contactable: c.contactable,
      withPhone: c.with_phone,
      hot: c.hot,
    };
  }

  return overview as OperationsOverview;
}
