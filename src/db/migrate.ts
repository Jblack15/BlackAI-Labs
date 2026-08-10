// DealFlow AI — Migration runner for Neon serverless Postgres.
//
// Usage:
//   bun run src/db/migrate.ts            # applies every migration in order
//
// Applies src/db/migrations/*.sql in filename order. Every migration is
// written idempotently (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) so this is
// safe to re-run. Neon does not support multiple commands in one prepared
// statement, so statements are split on semicolons (respecting $$...$$
// dollar-quote blocks) and executed individually.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const MIGRATIONS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "migrations");

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.slice(i, i + 2) === "$$" && !inDollarQuote) {
      inDollarQuote = true;
      current += "$$";
      i++;
      continue;
    }
    if (sql.slice(i, i + 2) === "$$" && inDollarQuote) {
      inDollarQuote = false;
      current += "$$";
      i++;
      continue;
    }
    if (sql[i] === ";" && !inDollarQuote) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += sql[i];
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — cannot run migrations.");
    process.exit(1);
  }
  const sql = neon(url);
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitSqlStatements(raw);
    let n = 0;
    for (const stmt of statements) {
      await sql.query(stmt);
      n++;
    }
    console.log(`applied ${file} (${n} statement${n === 1 ? "" : "s"})`);
  }
  console.log("all migrations applied");
}

main().catch((err) => {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
