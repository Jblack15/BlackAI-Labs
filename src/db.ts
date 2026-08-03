import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries.",
    );
  }
  _client = neon(url);
  return _client;
}

/**
 * Server-only handle to the team's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL`, which the owner connects via
 * the database card and which is injected into the sandbox and passed to the live
 * host on publish.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code). It's a tagged-template function:
 *
 *   import { sql } from "~/db";
 *   const rows = await sql`SELECT id, title FROM posts`;
 *
 * For raw SQL strings, use sql.query():
 *
 *   const rows = await sql.query("SELECT id, title FROM posts");
 */

// Lazy proxy: resolves client on first use, throws only when actually queried.
// The target MUST be a callable function — a Proxy is only callable when its
// target is callable, so a plain-object target would make `sql`...` throw
// "not a function" and silently disable every tagged-template query.
const callableTarget = (() => {}) as NeonQueryFunction<false, false>;
export const sql = new Proxy(callableTarget, {
  get(_target, prop) {
    const client = getClient();
    const val = (client as any)[prop];
    if (typeof val === "function") return val.bind(client);
    return val;
  },
  apply(_target, _thisArg, args) {
    const client = getClient();
    return (client as any)(...args);
  },
});
