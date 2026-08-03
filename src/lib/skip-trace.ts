import { sql } from "~/db";
export type SkipTraceLead = { id: string; full_name: string; property_address: string; property_city: string; property_state: string; property_zip: string };
export type SkipTraceResult = { success: boolean; updated: number; error?: string };
export async function skipTraceLeads(ids?: string[]): Promise<SkipTraceResult> {
  const key=process.env.SKIP_TRACE_API_KEY, url=process.env.SKIP_TRACE_API_URL;
  if(!key) return {success:false,updated:0,error:"Skip tracing API not configured — add SKIP_TRACE_API_KEY"};
  const leads=(ids?.length ? await sql`SELECT id,full_name,property_address,property_city,property_state,property_zip FROM leads WHERE id = ANY(${ids})` : await sql`SELECT id,full_name,property_address,property_city,property_state,property_zip FROM leads WHERE phone IS NULL OR phone = ''`) as SkipTraceLead[];
  if(!leads.length) return {success:true,updated:0};
  const response=await fetch(url||"https://api.batchskiptracing.com/v1/skip-trace",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify({leads:leads.map(l=>({id:l.id,name:l.full_name,address:l.property_address,city:l.property_city,state:l.property_state,zip:l.property_zip}))})});
  if(!response.ok) return {success:false,updated:0,error:`Skip trace request failed (${response.status})`};
  const data=await response.json() as {results?:Array<{id:string;phone?:string;email?:string}>}; let updated=0;
  for(const item of data.results||[]){if(item.phone||item.email){await sql`UPDATE leads SET phone=COALESCE(NULLIF(${item.phone||""},''),phone),email=COALESCE(NULLIF(${item.email||""},''),email),enriched_at=now() WHERE id=${item.id}`;await sql`INSERT INTO notifications(lead_id,type,title,message) VALUES(${item.id},'enrichment','Lead enriched','Skip tracing returned contact information.')`;updated++;}}
  return {success:true,updated};
}
