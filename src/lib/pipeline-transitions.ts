// DealFlow AI — Valid pipeline transitions map.
//
// Pure module (no DB imports) so it can be imported statically from client
// components — the CRM uses it to render only valid next stages in dropdowns.
// `src/lib/pipeline.ts` re-exports this as its own VALID_TRANSITIONS export.
export const VALID_TRANSITIONS: Record<string, string[]> = {
  new_lead: ["property_enrichment", "closed_lost"],
  property_enrichment: ["ai_qualification", "closed_lost"],
  ai_qualification: ["seller_contacted", "closed_lost"],
  seller_contacted: ["follow_up", "deal_analysis", "closed_lost"],
  follow_up: ["seller_contacted", "deal_analysis", "closed_lost"],
  deal_analysis: ["offer_recommendation", "follow_up", "closed_lost"],
  offer_recommendation: ["human_approval", "closed_lost"],
  human_approval: ["offer_sent", "offer_recommendation", "closed_lost"],
  offer_sent: ["negotiation", "follow_up", "closed_lost"],
  negotiation: ["contract_prepared", "follow_up", "closed_lost"],
  contract_prepared: ["contract_sent", "closed_lost"],
  contract_sent: ["contract_signed", "closed_lost"],
  contract_signed: ["buyer_matching", "closed_lost"],
  buyer_matching: ["buyer_contacted", "closed_lost"],
  buyer_contacted: ["assignment", "closed_lost"],
  assignment: ["closing", "closed_lost"],
  closing: ["closed_won", "closed_lost"],
};

/** Valid next stages for a lead currently in `stage`, falling back to the full
 *  stage list if the stage is unknown (e.g. legacy rows not yet transitioned). */
export function validNextStages(stage: string, allStages: string[]): string[] {
  const valid = VALID_TRANSITIONS[stage];
  if (valid && valid.length > 0) return valid;
  return allStages;
}
