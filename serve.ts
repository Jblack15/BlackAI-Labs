// Production server for the Astro static site.
// Serves the built output from dist/ on port 3000.
// Run `bun run build` before starting. Restart via `bun run publish`.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const PORT = 3000;
const HOST = "0.0.0.0";
const DIST_DIR = `${import.meta.dir}/dist`;

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
        let pathname = url.pathname;

        // Map clean URLs to .html files
        if (pathname.endsWith("/")) {
          pathname += "index.html";
        } else if (!pathname.includes(".")) {
          pathname += ".html";
        }

        const filePath = join(DIST_DIR, pathname);

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
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

console.log(`FleetClaim AI serving on http://${HOST}:${String(PORT)}`);
