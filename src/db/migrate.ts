// Migration runner — run with: bun run src/db/migrate.ts
import { neon } from "@neondatabase/serverless";
import * as fs from "node:fs";
import * as path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

function splitSqlStatements(sql: string): string[] {
  // Split on semicolons but respect $$...$$ blocks (for function bodies)
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
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    } else {
      current += sql[i];
    }
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

async function main() {
  const migrationsDir = path.join(import.meta.dirname, "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_..., 002_..., etc.

  for (const file of files) {
    const migrationPath = path.join(migrationsDir, file);
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");
    console.log(`\nRunning migration ${file}...`);

    const statements = splitSqlStatements(migrationSql);
    console.log(`Found ${statements.length} statements`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.substring(0, 60).replace(/\n/g, " ");
      try {
        await sql.query(stmt);
        console.log(`  [${i + 1}/${statements.length}] OK: ${preview}...`);
      } catch (err: any) {
        // "already exists" errors are OK for IF NOT EXISTS
        if (err.message?.includes("already exists") || err.message?.includes("duplicate")) {
          console.log(`  [${i + 1}/${statements.length}] SKIP (exists): ${preview}...`);
        } else {
          console.error(`  [${i + 1}/${statements.length}] ERROR: ${preview}... -> ${err.message}`);
        }
      }
    }
  }

  // Verify tables
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log("\nTables in public schema:", tables.map((t: any) => t.table_name).join(", "));
  console.log("All migrations complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
