import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// PH1-B14 part 2: keep the SERVER-ONLY auth module out of client bundles.
// src/lib/auth.ts (node:crypto / node:util / neon) is statically imported by
// src/components/Header.tsx (its createServerFn middleware option survives the
// client transform) and by the /api/auth/* route files (their top-level
// imports survive client-side). Bundling it would fail the client build
// ("promisify" is not exported by __vite-browser-external) and would leak the
// df_session cookie name to every visitor (spec §12). This transform hook
// rewrites the surviving `~/lib/auth` import to src/lib/auth.client-stub.ts
// for the CLIENT environment only; the server + SSR environments are untouched
// and keep resolving the real auth.ts, so the auth protocol and the owner
// middleware run the real code. A plain resolveId hook does NOT work here:
// TanStack Start's own (enforce-pre) resolveId resolves `~/lib/auth` before
// any normal-priority hook sees it (verified during B14 part 2 — the import
// only ever reached a transform hook). Route files are unaffected: their
// transforms strip the auth import entirely, and this rewrite only fires when
// the import survives (Header + API routes).
const authClientStub: Plugin = {
  name: "dealforge:auth-client-stub",
  transform(code, id) {
    if (this.environment?.name !== "client") return null;
    if (id.includes("/src/components/Header.tsx") || id.includes("/src/routes/api/auth/")) {
      const re = /from\s+["']~\/lib\/auth["']/g;
      if (re.test(code)) {
        const stub = `${import.meta.dirname}/src/lib/auth.client-stub.ts`;
        return { code: code.replace(re, `from "${stub}"`), map: null };
      }
    }
    return null;
  },
};

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
    // masks the Host to localhost:3000, but accept any host so a dev server never
    // rejects a proxied request with "Blocked request".
    allowedHosts: true,
    // The dev server is reachable through the TLS proxy, so the HMR websocket
    // must dial back on 443, not the dev port. If the socket can't connect,
    // pages still serve — hot reload degrades, never breaks.
    hmr: { clientPort: 443 },
    // The dev server can serve source files; never let it serve local secrets,
    // and never let it serve anything outside the site dir. Gotchas this list
    // encodes: a custom `deny` REPLACES Vite's defaults (so .git must be
    // restated), patterns containing "/" match the ABSOLUTE path (so dir
    // patterns need a leading **/), and `allow` left to its default widens to
    // the nearest workspace root — a stray .git or workspaces package.json in
    // /home/team/shared would expose the whole shared dir.
    fs: {
      strict: true,
      allow: [import.meta.dirname],
      deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.run/**", "**/.git/**"],
    },
  },
  plugins: [
    authClientStub,
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart(),
    viteReact(),
  ],
});
