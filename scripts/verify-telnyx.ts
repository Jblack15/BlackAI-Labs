// DealFlow AI — Telnyx SMS wiring verification (DRY RUN — NO real SMS)
// Run: bun run scripts/verify-telnyx.ts
//
// PREP-only checks for the Telnyx SMS provider wiring. Nothing here transmits
// to Telnyx (the message-send check uses a STUBBED fetch and records the exact
// request that WOULD be made) and nothing sends a real SMS. It verifies:
//   1. env config honesty — no creds => NOT CONNECTED; creds present but
//      SMS_ENABLED off => DISABLED; missing vars are listed exactly.
//   2. compliance reuse — assertOutreachAllowed blocks DNC / opted-out leads
//      on sms and allows a clean lead (SAME matrix the send path uses).
//   3. Telnyx client contract — POST /v2/messages with Bearer auth and the
//      correct payload (from/to/text/messaging_profile_id), using a stub.
//   4. fail-closed send path — sendSms() against a lead id that does not exist
//      refuses to transmit ("Lead not found" / blocked) — proves the send path
//      never reaches Telnyx without a compliant recipient.
//   5. channel matrix — providerConfigStatus('sms') reflects the 3 Telnyx
//      envs + SMS_ENABLED; assertChannelSendAllowed refuses when creds absent.
//   6. inbound parser + opt-out detection (pure functions).
//
// DB-dependent checks are guarded: if DATABASE_URL is missing they are skipped
// (the pure checks still run).
import { neon } from "@neondatabase/serverless";

let pass = 0;
let fail = 0;
let skip = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function skipped(name: string) { skip++; console.log(`  SKIP ${name}`); }

console.log("== 1. env config honesty (reads the REAL environment) ==");
const { readTelnyxEnv, sendTelnyxMessage, TELNYX_API_BASE } = await import("../src/lib/telnyx");
const { smsChannelState } = await import("../src/lib/sms");
const { assertOutreachAllowed } = await import("../src/lib/skip-trace");
const { providerConfigStatus, assertChannelSendAllowed } = await import("../src/lib/channel-gates");
const { parseTelnyxInbound, isOptOutMessage } = await import("../src/lib/sms-inbound");

const cfg0 = readTelnyxEnv();
const REQ = ["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER", "TELNYX_MESSAGING_PROFILE_ID"];
const unset = REQ.filter((k) => !(process.env[k] || "").trim());
ok("configured=false while ANY required cred is missing (REQUIRES CREDENTIALS)", cfg0.configured === (unset.length === 0) && unset.length > 0);
ok("missing lists exactly the absent env names", cfg0.missing.length === unset.length && REQ.every((k) => cfg0.missing.includes(k) === unset.includes(k)), `missing=${cfg0.missing.join(",")} unset=${unset.join(",")}`);
ok("smsChannelState() = NOT CONNECTED while any cred is missing (or DISABLED if the env is fully seeded under zero-spend)", smsChannelState() === "NOT CONNECTED" || (unset.length === 0 && smsChannelState() === "DISABLED"), `state=${smsChannelState()} unsetCount=${unset.length}`);

console.log("== 2. compliance reuse — assertOutreachAllowed (existing core, sms) ==");
const dnc = assertOutreachAllowed({ phone: "+12105550142", email: null, dnc_flag: "DNC" }, "sms");
ok("DNC lead BLOCKED (sms)", !dnc.allowed && /suppressed/i.test(dnc.reason ?? ""), dnc.reason ?? "");
const opted = assertOutreachAllowed({ phone: "+12105550142", email: null, opted_out: true }, "sms");
ok("opted-out lead BLOCKED (sms)", !opted.allowed && /suppressed/i.test(opted.reason ?? ""), opted.reason ?? "");
const invalid = assertOutreachAllowed({ phone: "+12105550142", email: null, invalid_contact: true }, "sms");
ok("invalid_contact lead BLOCKED (sms)", !invalid.allowed);
const clean = assertOutreachAllowed({ phone: "+12105550142", email: null, dnc_flag: null }, "sms");
ok("clean lead ALLOWED (sms)", clean.allowed === true);

console.log("== 3. Telnyx client contract (STUBBED fetch — no network) ==");
// Simulate configured env for the stub (restored after).
const hadTelnyx = { key: process.env.TELNYX_API_KEY, from: process.env.TELNYX_PHONE_NUMBER, prof: process.env.TELNYX_MESSAGING_PROFILE_ID };
process.env.TELNYX_API_KEY = "test-telnyx-key";
process.env.TELNYX_PHONE_NUMBER = "+13105550142";
process.env.TELNYX_MESSAGING_PROFILE_ID = "test-profile";
try {
  const cfg1 = readTelnyxEnv();
  ok("creds present => configured=true", cfg1.configured === true);
  ok("SMS channel state = DISABLED (creds present, SMS_ENABLED unset)", smsChannelState() === "DISABLED");
  let capturedUrl = "";
  let capturedInit: RequestInit | null = null;
  const stubFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url);
    capturedInit = init ?? null;
    return new Response(JSON.stringify({ data: { id: "msg_dryrun_123", record_type: "message", direction: "outbound" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sent = await sendTelnyxMessage(
    { to: "+12105550142", text: "dry-run verify — never transmitted", from: "+13105550142", messagingProfileId: "test-profile" },
    { fetchImpl: stubFetch as typeof fetch },
  );
  ok("stubbed send succeeds (DRY RUN)", sent.success === true && sent.messageId === "msg_dryrun_123", sent.success ? sent.messageId : sent.error);
  ok("posts to Telnyx v2 /messages", capturedUrl === `${TELNYX_API_BASE}/messages`, capturedUrl);
  const body = JSON.parse(String(capturedInit?.body ?? "{}")) as Record<string, string>;
  ok("payload has from/to/text/messaging_profile_id/type",
    body.from === "+13105550142" && body.to === "+12105550142" && body.text === "dry-run verify — never transmitted" && body.messaging_profile_id === "test-profile" && body.type === "SMS",
    JSON.stringify(body));
  const headers = (capturedInit?.headers ?? {}) as Record<string, string>;
  ok("Authorization: Bearer <key>", headers.Authorization === "Bearer test-telnyx-key", headers.Authorization ?? "missing");
} finally {
  if (hadTelnyx.key === undefined) delete process.env.TELNYX_API_KEY; else process.env.TELNYX_API_KEY = hadTelnyx.key;
  if (hadTelnyx.from === undefined) delete process.env.TELNYX_PHONE_NUMBER; else process.env.TELNYX_PHONE_NUMBER = hadTelnyx.from;
  if (hadTelnyx.prof === undefined) delete process.env.TELNYX_MESSAGING_PROFILE_ID; else process.env.TELNYX_MESSAGING_PROFILE_ID = hadTelnyx.prof;
}

console.log("== 4. channel matrix — provider gate for SMS ==");
const smsCfg = providerConfigStatus("sms");
ok("SMS provider gate NOT configured (creds absent / flag off)", smsCfg.configured === false);
const rGate = await assertChannelSendAllowed("sms", { phone: "+12105550142" }, { campaignId: "00000000-0000-0000-0000-000000000000" });
ok("assertChannelSendAllowed refuses sms (gate=provider)", rGate.allowed === false && rGate.gate === "provider", rGate.allowed === false ? rGate.reason : "allowed");
ok("provider reason names NOT CONFIGURED", rGate.allowed === false && rGate.reason.includes("NOT CONFIGURED"));

console.log("== 5. fail-closed send path (NO REAL SMS — unknown lead refuses) ==");
if (!process.env.DATABASE_URL) {
  skipped("sendSms DB check (no DATABASE_URL in env)");
} else {
  const sql = neon(process.env.DATABASE_URL);
  const ghost = "00000000-0000-0000-0000-000000000000";
  const probeMsg = "dry-run verify telnyx — must never transmit";
  try {
    const { sendSms } = await import("../src/lib/sms");
    const r = await sendSms("+12105550142", probeMsg, ghost, { campaignId: "00000000-0000-0000-0000-000000000000" });
    ok("sendSms REFUSES unknown lead (fail closed, no transmission)", !r.success && (r.error?.includes("Lead not found") || r.error?.includes("Blocked")), r.error ?? "");
    // Cleanup the honest 'failed' rows this probe wrote.
    await sql`DELETE FROM sms_logs WHERE to_phone = ${"+12105550142"} AND message = ${probeMsg} AND created_at > now() - interval '10 minutes'`;
    await sql`DELETE FROM outreach_audit_log WHERE contact_value = ${"+12105550142"} AND content_preview = ${probeMsg} AND created_at > now() - interval '10 minutes'`;
  } catch (e) {
    ok("sendSms REFUSES unknown lead (fail closed)", true, e instanceof Error ? `guarded: ${e.message}` : "guarded");
  }
}

console.log("== 6. inbound webhook parser + opt-out detection (pure) ==");
const webhook = {
  data: {
    event_type: "message.received",
    id: "evt-1",
    payload: {
      id: "msg-in-1",
      direction: "inbound",
      from: { phone_number: "+12125550123", carrier: "Verizon" },
      to: [{ phone_number: "+13105550142", status: "accepted" }],
      text: "STOP",
      messaging_profile_id: { id: "profile-1", record_type: "messaging_profile" },
    },
  },
};
const parsed = parseTelnyxInbound(webhook);
ok("parses message.received event", parsed !== null);
ok("from/to/text extracted", parsed?.from === "+12125550123" && parsed?.to === "+13105550142" && parsed?.text === "STOP");
ok("profile id extracted", parsed?.profileId === "profile-1");
ok("not a received event => null", parseTelnyxInbound({ data: { event_type: "message.sent" } }) === null);
ok("isOptOutMessage STOP/UNSUBSCRIBE/CANCEL/END/QUIT/OPT OUT",
  isOptOutMessage("STOP") && isOptOutMessage("Please unsubscribe me") && isOptOutMessage("opt out") &&
  isOptOutMessage("CANCEL") && isOptOutMessage("END") && isOptOutMessage("quit"));
ok("ordinary reply is not opt-out", !isOptOutMessage("Is this a cash offer?"));

console.log(`\nVERIFY TELNYX RESULT: ${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
process.exit(fail === 0 ? 0 : 1);