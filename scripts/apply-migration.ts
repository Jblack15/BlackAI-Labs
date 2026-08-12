// Migration runner for DealFlow AI — applies one migration file to the live
// Neon database. Usage:
//   bun run scripts/apply-migration.ts src/db/migrations/012_outreach_status.sql
//
// Neon does not support multiple statements in one prepared statement, so the
// file is split on semicolons while respecting PL/pgSQL dollar-quote blocks
// ($$ ... $$). Migration files MUST NOT contain semicolons inside -- comments
// or literal dollar-quote openers inside comments (see neon-db-migrate skill).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

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

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun run scripts/apply-migration.ts <migration.sql>");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(url);
const source = readFileSync(file, "utf8");
const statements = splitSqlStatements(source);
console.log(`Applying ${file}: ${statements.length} statement(s)`);
for (const [i, stmt] of statements.entries()) {
  try {
    await sql.query(stmt);
    console.log(`  ok (${i + 1}/${statements.length})`);
  } catch (err) {
    console.error(`  FAILED (${i + 1}/${statements.length}):`, err instanceof Error ? err.message : err);
    console.error("Statement head:", stmt.slice(0, 160));
    process.exit(1);
  }
}
console.log("Migration applied.");
process.exit(0);
