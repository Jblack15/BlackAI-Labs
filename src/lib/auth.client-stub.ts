// DealFlow AI — Client-only build stub for ~/lib/auth (PH1-B14, part 2).
//
// WHY THIS FILE EXISTS: src/lib/auth.ts is SERVER-ONLY (node:crypto scrypt /
// timingSafeEqual, node:util, neon Postgres). TanStack Start strips the
// auth import from ROUTE files, but two client-graph surfaces still resolve
// `~/lib/auth`: (1) src/components/Header.tsx keeps its createServerFn
// `middleware: [requireOwnerMiddleware]` option client-side, and (2) API route
// files (/api/auth/*) keep their top-level imports client-side. Bundling the
// real auth.ts into the client fails the build ("promisify" is not exported
// by __vite-browser-external) and would ship the session cookie name to every
// visitor — the exact leak spec §12 forbids.
//
// FIX: vite.config.ts adds a load hook that serves THIS stub whenever the
// `client` build environment asks to LOAD src/lib/auth.ts. The server and SSR
// environments are untouched and load the real auth.ts, so login/logout/
// status handlers and the owner middleware run the real code at runtime. The
// stub is never executed in the browser: API handlers only run server-side,
// and the client copy of the middleware is inert. It exists purely so the
// client bundle stays honest (no crypto, no DB, no cookie-name literal).
import { createMiddleware } from "@tanstack/react-start";

// A real-but-inert middleware object (createMiddleware is client-safe; the
// .server() guard body lives only in the real auth.ts). The client runtime
// accepts it; the server applies the REAL middleware from auth.ts.
export const requireOwnerMiddleware = createMiddleware({ type: "request" });

// --- Inert stand-ins for the auth protocol surface (never called in a
//     browser; kept so the API-route client copies bind cleanly). The cookie
//     name constant deliberately holds NO secret value here — the real value
//     lives only in src/lib/auth.ts, which never reaches a client bundle. ---
export const SESSION_COOKIE = "";
export const SESSION_TTL_MS = 86_400_000;
export const SESSION_MAX_AGE_SECONDS = 86_400;
export function randomToken(): string {
  return "stub-token";
}
export function sha256Hex(_value: string): string {
  return "stub";
}

export type AuthSession = { id: string; role: string };
export type AuthAuditStatus = "login_ok" | "login_failed" | "blocked" | "logout" | "revoked";

export async function hashPin(_pin: string): Promise<string> {
  return "stub";
}
export async function verifyPin(_pin: string, _storedHash: string): Promise<boolean> {
  return false;
}
export function parseCookies(_header: string | null): Record<string, string> {
  return {};
}
export function serializeCookie(
  _name: string,
  _value: string,
  _opts: { maxAge?: number; httpOnly?: boolean; sameSite?: "Lax" | "Strict" | "None"; path?: string; secure?: boolean } = {},
): string {
  return "";
}
export function sessionCookie(_value: string, _maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  return "";
}
export async function getSessionFromRequest(_request: Request): Promise<AuthSession | null> {
  return null;
}
export function getClientIp(_request: Request): string {
  return "stub";
}
export function checkLoginRateLimit(_ip: string): { locked: boolean } {
  return { locked: false };
}
export function recordLoginFailure(_ip: string): { locked: boolean; triggered: boolean } {
  return { locked: false, triggered: false };
}
export function resetLoginRateLimit(): void {}
export async function logAuthAudit(_opts: {
  status: AuthAuditStatus;
  reason: string;
  operator?: string | null;
  contactValue?: string | null;
}): Promise<void> {}
