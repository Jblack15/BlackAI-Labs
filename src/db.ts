import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Server-only handle to the team's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL`, which the owner connects via
 * the database card and which is injected into the sandbox and passed to the live
 * host on publish. Resolved lazily (per call, not at module load) so the site
 * still builds and serves before a database is connected — the error only
 * surfaces if a query actually runs without `DATABASE_URL`.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code):
 *
 *   const getPosts = createServerFn().handler(async () => {
 *     const rows = await sql`select id, title, created_at from posts`;
 *     // Coerce non-primitive columns (timestamps are JS Dates) to strings before
 *     // returning to the client, or React will refuse to render them:
 *     return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
 *   });
 *
 * `sql` is a lazy Proxy whose target is a callable function: the proxy forwards
 * tagged-template calls (`sql\`...\``) and property access (`sql.query(...)`)
 * to the underlying neon function. This is what makes the `sql\`...\`` syntax
 * used across src/lib work — the proxy target must stay callable, otherwise
 * every query throws and pages silently fall back to mock data.
 */
function createSql(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries.",
    );
  }
  return neon(url);
}

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (!client) client = createSql();
  return client;
}

export const sql = new Proxy(function () {} as unknown as NeonQueryFunction<false, false>, {
  apply(_target, _thisArg, argArray) {
    return getClient().apply(null, argArray as [TemplateStringsArray, ...unknown[]]);
  },
  get(_target, prop, receiver) {
    if (prop === "then") return undefined; // never treat sql as a thenable
    return Reflect.get(getClient(), prop, receiver);
  },
}) as NeonQueryFunction<false, false>;
