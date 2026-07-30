// Session management utilities for CollisionAI
// Uses a simple signed cookie approach with Bun's SHA256.

const SESSION_SECRET = "collisionai-session-secret-2026"; // Will become an env var later
const COOKIE_NAME = "auth_token";

interface SessionPayload {
  userId: number;
  timestamp: number;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sha256Hex(data: string): string {
  const hash = Bun.SHA256.hash(data);
  return toHex(new Uint8Array(hash));
}

export function createSessionToken(userId: number): string {
  const timestamp = Date.now();
  const payload = `${userId}:${timestamp}`;
  const signature = sha256Hex(`${SESSION_SECRET}${userId}${timestamp}`);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [payload, signature] = token.split(".");
    const [userIdStr, timestampStr] = payload.split(":");
    const userId = parseInt(userIdStr, 10);
    const timestamp = parseInt(timestampStr, 10);

    if (!userId || !timestamp) return null;

    const expectedSig = sha256Hex(`${SESSION_SECRET}${userId}${timestamp}`);
    if (signature !== expectedSig) return null;

    // Sessions expire after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > THIRTY_DAYS) return null;

    return { userId, timestamp };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  });
  return cookies;
}

export function getSessionFromRequest(request: Request): SessionPayload | null {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

export function createSessionCookieHeader(token: string): string {
  // Set cookie for 30 days, path=/, httpOnly, sameSite=lax
  const maxAge = 30 * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
