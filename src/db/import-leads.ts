// Idempotent import: DATABASE_URL="..." bun run src/db/import-leads.ts
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_URL is not set");
const sql = neon(url);
function parseCsv(text: string) { const lines=text.trim().split(/\r?\n/); const out:string[][]=[]; for(const line of lines){let row:string[]=[];let cur="", quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(c==='"') quote=!quote;else if(c===','&&!quote){row.push(cur);cur="";}else cur+=c;}row.push(cur);out.push(row);} return out; }
const rows=parseCsv(readFileSync("/home/team/shared/leads/san-antonio-leads.csv","utf8")); const headers=rows.shift()!; const ix=(x:string)=>headers.indexOf(x);
for(const r of rows){const source=r[ix("lead_source")];const stage=source==="Appointment of Substitute Trustee"?"contacted":"new";await sql`INSERT INTO leads (full_name,property_address,property_city,property_state,property_zip,phone,lead_source,notes,status) VALUES (${r[ix("name")]},${r[ix("address")]},${r[ix("city")]},${r[ix("state")]},${r[ix("zip")]},NULL,${source},${r[ix("notes")]},${stage}) ON CONFLICT DO NOTHING`;}
console.log(`Imported ${rows.length} leads (safe to re-run).`);
