// Production server for the Astro static site.
// Serves the built output from dist/ on port 3000 and exposes two JSON API
// endpoints used by the contact form and the lead-viewing tooling:
//
//   POST /api/contact — accept a demo request and append it to .data/leads.json
//   GET  /api/leads   — return all captured leads (bearer-token protected)
//
// API routes take priority over the static file handler. Run `bun run build`
// before starting. Restart via `bun run publish`.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const PORT = 3000;
const HOST = "0.0.0.0";
const DIST_DIR = `${import.meta.dir}/dist`;
const DATA_DIR = `${import.meta.dir}/.data`;
const LEADS_FILE = join(DATA_DIR, "leads.json");

const MAX_BODY_BYTES = 64 * 1024; // Reject oversized request bodies early.

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/* ---------------------------------- API ---------------------------------- */

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

// Simple in-process queue so concurrent POSTs serialize their read-modify-write
// instead of clobbering each other. Low-volume lead capture, so a file-backed
// JSON array is plenty; a database can replace this later without touching the
// route handlers.
let leadsWriteQueue: Promise<void> = Promise.resolve();

async function appendLead(lead: Record<string, string>): Promise<void> {
  const run = async (): Promise<void> => {
    await mkdir(DATA_DIR, { recursive: true });
    let leads: unknown[] = [];
    if (existsSync(LEADS_FILE)) {
      try {
        const parsed = JSON.parse(await readFile(LEADS_FILE, "utf8"));
        if (Array.isArray(parsed)) leads = parsed;
      } catch {
        // Corrupt/unreadable file: start fresh rather than fail the request.
      }
    }
    leads.push(lead);
    await writeFile(LEADS_FILE, JSON.stringify(leads, null, 2) + "\n", "utf8");
  };
  const result = leadsWriteQueue.then(run, run);
  leadsWriteQueue = result.catch(() => {});
  return result;
}

async function readLeads(): Promise<unknown[]> {
  if (!existsSync(LEADS_FILE)) return [];
  try {
    const parsed = JSON.parse(await readFile(LEADS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Constant-time comparison (lengths are checked first so a size mismatch is not
// a timing leak; dev-grade token, but there's no reason to make it easy).
function secureCompare(a: string, b: string): boolean {
  const aBuf = new TextEncoder().encode(a);
  const bBuf = new TextEncoder().encode(b);
  if (aBuf.length !== bBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) diff |= aBuf[i] ^ bBuf[i];
  return diff === 0;
}

async function handleContact(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Payload too large" });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Request body must be valid JSON" });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { error: "Request body must be a JSON object" });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const record = body as Record<string, unknown>;
  const firstName = str(record.firstName);
  const lastName = str(record.lastName);
  const email = str(record.email);
  const company = str(record.company);
  const role = str(record.role);
  const plan = str(record.plan);
  const message = str(record.message);

  const fields: Record<string, string> = {};
  if (!firstName) fields.firstName = "First name is required.";
  if (!email) fields.email = "Email is required.";
  else if (!isValidEmail(email)) fields.email = "A valid email address is required.";
  if (Object.keys(fields).length > 0) {
    return json(400, { error: "Validation failed", fields });
  }

  const lead = {
    firstName,
    lastName,
    email,
    company,
    role,
    plan,
    message,
    submittedAt: new Date().toISOString(),
  };

  try {
    await appendLead(lead);
  } catch (err) {
    console.error("[FleetClaim AI] Failed to persist lead:", err);
    return json(500, { error: "Could not save your request. Please try again." });
  }

  console.log(
    `[FleetClaim AI] Lead captured: ${email} (${firstName} ${lastName}, ` +
      `company=${company || "n/a"}, role=${role || "n/a"}, plan=${plan || "none"}, message="${message.slice(0, 80)}")`,
  );
  return json(200, { ok: true, message: "Lead captured", submittedAt: lead.submittedAt });
}

async function handleLeads(req: Request): Promise<Response> {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.LEADS_API_TOKEN || "fleetclaim-dev-token";

  if (!token || !secureCompare(token, expected)) {
    return json(401, { error: "Unauthorized" });
  }

  const leads = await readLeads();
  return json(200, leads);
}

/* ------------------------------ Static serving ---------------------------- */

// Resolve a request path to a file under dist/. Astro's static output uses
// directory-style routes (dist/<route>/index.html), so clean URLs like
// "/contact" must resolve to dist/contact/index.html — not dist/contact.html.
function resolveStaticPath(pathname: string): string {
  let relative: string;
  if (pathname.endsWith("/")) {
    relative = `${pathname}index.html`;
  } else if (extname(pathname) === "") {
    // Prefer the directory-style output (dist/<route>/index.html), falling
    // back to a flat file (dist/<route>.html) for any legacy layouts.
    if (existsSync(join(DIST_DIR, pathname, "index.html"))) {
      relative = `${pathname}/index.html`;
    } else {
      relative = `${pathname}.html`;
    }
  } else {
    relative = pathname;
  }
  return join(DIST_DIR, relative);
}

async function serveStatic(pathname: string): Promise<Response> {
  const filePath = resolveStaticPath(pathname);

  // Normalize to prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    return new Response("Not found", { status: 404 });
  }

  if (existsSync(filePath)) {
    const content = await readFile(filePath);
    return new Response(content, {
      headers: { "Content-Type": getContentType(filePath) },
    });
  }

  // Fallback: try index.html for SPA-like behavior
  const indexPath = join(DIST_DIR, "index.html");
  if (existsSync(indexPath)) {
    const content = await readFile(indexPath);
    return new Response(content, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not found", { status: 404 });
}

/* --------------------------------- Server --------------------------------- */

// Free PORT regardless of which user owns the current listener.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

for (let attempt = 1; ; attempt++) {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;
        const start = performance.now();

        // CORS preflight for API routes.
        if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
          return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // API routes take priority over the static file handler.
        let response: Response;
        if (pathname === "/api/contact") {
          response = await handleContact(req);
        } else if (pathname === "/api/leads") {
          response = await handleLeads(req);
        } else if (pathname.startsWith("/api/")) {
          response = json(404, { error: "Not found" });
        } else {
          response = await serveStatic(pathname);
        }

        console.log(
          `[FleetClaim AI] ${req.method} ${pathname} → ${response.status} (${Math.round(performance.now() - start)}ms)`,
        );
        return response;
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

console.log(`FleetClaim AI serving on http://${HOST}:${String(PORT)}`);
console.log(`[FleetClaim AI] API: POST /api/contact · GET /api/leads (token: ${process.env.LEADS_API_TOKEN ? "env" : "default"})`);
