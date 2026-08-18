// POST /api/auth/logout — revoke the current session and clear the cookie.
// Always ok (even with no/invalid cookie — spec §2): the cookie is cleared with
// Max-Age=0 and any matching live session row is revoked (revoke_reason='logout').
// Responses: 200 {ok:true, revoked:boolean} with Set-Cookie clearing df_session.
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { SESSION_COOKIE, logAuthAudit, parseCookies, sessionCookie, sha256Hex } from "~/lib/auth";

async function logout({ request }: { request: Request }): Promise<Response> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  let revoked = false;
  if (token) {
    const tokenHash = sha256Hex(token);
    const rows = (await sql`
      UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'logout'
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      RETURNING id
    `) as Array<{ id: string }>;
    revoked = rows.length > 0;
  }
  await logAuthAudit({ status: "logout", reason: "Logout — session revoked", operator: "owner" });
  return Response.json(
    { ok: true, revoked },
    { status: 200, headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", 0) } },
  );
}

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: logout,
    },
  },
} as never);
