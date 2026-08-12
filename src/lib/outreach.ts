import { sql } from "~/db";
import { sendSms } from "~/lib/sms";
export const SMS_SEQUENCE=[
  (name:string,address:string)=>`Hi ${name}, this is DealForge Properties. We’re reaching out about ${address}. Would you be open to a quick conversation about a cash offer? Reply STOP to opt out.`,
  (name:string,address:string)=>`Hi ${name}, just following up about ${address}. If selling is on your mind, we can provide a no-obligation cash offer. Reply STOP to opt out.`,
  (name:string,address:string)=>`Hi ${name}, this is our last follow-up about ${address}. If now isn’t the right time, no problem. Reply STOP to opt out.`
];
export async function startSmsOutreach(leadId:string){const rows=await sql`SELECT full_name,phone,property_address,property_city,property_state FROM leads WHERE id=${leadId}` as any[];const lead=rows[0];if(!lead?.phone)return {success:false,error:"Lead has no phone number"};const address=`${lead.property_address}, ${lead.property_city}, ${lead.property_state}`;const result=await sendSms(lead.phone,SMS_SEQUENCE[0](lead.full_name,address),leadId);if(!result.success)return result;for(const [step,days] of [[2,2],[3,7]] as const) await sql`INSERT INTO outreach_sequences(lead_id,channel,step,status,scheduled_for) VALUES(${leadId},'sms',${step},'scheduled',now()+(${days} * interval '1 day')) ON CONFLICT DO NOTHING`;return {success:true,sid:result.sid};}
export async function startBulkOutreach(){const rows=await sql`SELECT id FROM leads WHERE status='qualified' AND phone IS NOT NULL AND phone<>''`;let started=0;for(const row of rows as {id:string}[]){const r=await startSmsOutreach(row.id);if(r.success)started++;}return {success:true,started};}
