// Seed script — run with: bun run src/db/seed.ts
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// Canonical pipeline stages (matches migration 008 seed — kept in sync here so
// `bun run src/db/seed.ts` fully reproduces the pipeline on a fresh DB).
const PIPELINE_STAGES = [
  { name: "new_lead", display_order: 1, color: "slate", description: "Lead captured from any source, awaiting enrichment." },
  { name: "property_enrichment", display_order: 2, color: "blue", description: "Owner, property and lien data being enriched/skip-traced." },
  { name: "ai_qualification", display_order: 3, color: "cyan", description: "AI agent scoring motivation, equity and distress signals." },
  { name: "seller_contacted", display_order: 4, color: "purple", description: "First outreach sent to the seller." },
  { name: "follow_up", display_order: 5, color: "violet", description: "Nurturing the seller across the follow-up sequence." },
  { name: "deal_analysis", display_order: 6, color: "teal", description: "ARV, repairs and MAO being calculated by the deal analyst." },
  { name: "offer_recommendation", display_order: 7, color: "indigo", description: "AI recommends an offer range for human review." },
  { name: "human_approval", display_order: 8, color: "amber", description: "Offer awaiting human approval gate." },
  { name: "offer_sent", display_order: 9, color: "orange", description: "Approved offer presented to the seller." },
  { name: "negotiation", display_order: 10, color: "pink", description: "Back-and-forth with the seller on price and terms." },
  { name: "contract_prepared", display_order: 11, color: "sky", description: "Contract drafted for the agreed terms." },
  { name: "contract_sent", display_order: 12, color: "fuchsia", description: "Contract sent to the seller for signature." },
  { name: "contract_signed", display_order: 13, color: "emerald", description: "Signed contract in hand — deal is under contract." },
  { name: "buyer_matching", display_order: 14, color: "lime", description: "Matching the contract to cash buyers in the database." },
  { name: "buyer_contacted", display_order: 15, color: "green", description: "Buyer engaged on the assignment." },
  { name: "assignment", display_order: 16, color: "gold", description: "Assignment agreement signed with the end buyer." },
  { name: "closing", display_order: 17, color: "yellow", description: "Title/escrow working toward close." },
  { name: "closed_won", display_order: 18, color: "gold", description: "Deal closed — profit captured." },
  { name: "closed_lost", display_order: 19, color: "red", description: "Deal fell through or was abandoned." },
];

async function main() {
  console.log("Seeding database...");

  // Seed pipeline stages (idempotent)
  for (const stage of PIPELINE_STAGES) {
    await sql`
      INSERT INTO pipeline_stages (name, display_order, description, color)
      VALUES (${stage.name}, ${stage.display_order}, ${stage.description}, ${stage.color})
      ON CONFLICT (name) DO NOTHING
    `;
  }
  console.log(`Inserted ${PIPELINE_STAGES.length} pipeline stages`);

  // Seed leads (10 mock leads from CRM)
  const leads = [
    {
      full_name: "James Rodriguez", email: "james.r@email.com", phone: "(512) 555-0101",
      property_address: "1423 Elm Street", property_city: "Austin", property_state: "TX", property_zip: "78701",
      property_type: "Single Family", property_condition: "Fair", estimated_repairs: "25,000 - 40,000",
      reason_for_selling: "Inherited property, out of state owner", desired_timeline: "ASAP",
      mortgage_status: "Paid off", notes: "Inherited from aunt. Tenant occupied but lease ending soon.",
      lead_source: "probate", status: "new", created_at: "2026-07-30T09:15:00Z",
    },
    {
      full_name: "Maria Gonzalez", email: "maria.g@email.com", phone: "(210) 555-0202",
      property_address: "890 Oak Drive", property_city: "San Antonio", property_state: "TX", property_zip: "78209",
      property_type: "Single Family", property_condition: "Poor", estimated_repairs: "50,000 - 75,000",
      reason_for_selling: "Behind on taxes, facing lien", desired_timeline: "Within 30 days",
      mortgage_status: "Delinquent", notes: "Tax lien of $12,400. Needs roof and foundation work.",
      lead_source: "tax-delinquent", status: "new", created_at: "2026-07-29T14:30:00Z",
    },
    {
      full_name: "David Chen", email: "david.c@email.com", phone: "(214) 555-0303",
      property_address: "455 Pine Lane", property_city: "Dallas", property_state: "TX", property_zip: "75201",
      property_type: "Duplex", property_condition: "Good", estimated_repairs: "10,000 - 15,000",
      reason_for_selling: "Tired landlord, tenant issues", desired_timeline: "1-2 months",
      mortgage_status: "Current", notes: "Both units currently vacant after eviction. Wants out of landlording.",
      lead_source: "tired-landlord", status: "contacted", created_at: "2026-07-28T11:00:00Z",
    },
    {
      full_name: "Patricia Williams", email: "pat.w@email.com", phone: "(713) 555-0404",
      property_address: "2200 Maple Avenue", property_city: "Houston", property_state: "TX", property_zip: "77002",
      property_type: "Single Family", property_condition: "Fair", estimated_repairs: "20,000 - 30,000",
      reason_for_selling: "Pre-foreclosure, need to sell fast", desired_timeline: "ASAP",
      mortgage_status: "Behind 3 payments", notes: "Bank has started pre-foreclosure process. Owe $180k, ARV ~$290k.",
      lead_source: "pre-foreclosure", status: "contacted", created_at: "2026-07-27T10:45:00Z",
    },
    {
      full_name: "Robert Kim", email: "robert.k@email.com", phone: "(512) 555-0505",
      property_address: "77 Canyon Ridge Rd", property_city: "Round Rock", property_state: "TX", property_zip: "78664",
      property_type: "Single Family", property_condition: "Average", estimated_repairs: "15,000 - 25,000",
      reason_for_selling: "Relocating for work", desired_timeline: "Within 60 days",
      mortgage_status: "Current", notes: "Motivated. Relocating to Seattle. Needs to close before moving.",
      lead_source: "high-equity", status: "qualified", created_at: "2026-07-26T16:00:00Z",
    },
    {
      full_name: "Linda Thompson", email: "linda.t@email.com", phone: "(817) 555-0606",
      property_address: "333 Birch Street", property_city: "Fort Worth", property_state: "TX", property_zip: "76102",
      property_type: "Single Family", property_condition: "Poor", estimated_repairs: "40,000 - 60,000",
      reason_for_selling: "Code violations, cannot afford repairs", desired_timeline: "ASAP",
      mortgage_status: "Paid off", notes: "City issued 5 code violations. Needs major work. Owner on fixed income.",
      lead_source: "code-violations", status: "appointment", created_at: "2026-07-25T08:30:00Z",
    },
    {
      full_name: "Michael Davis", email: "mike.d@email.com", phone: "(469) 555-0707",
      property_address: "612 Cedar Court", property_city: "Plano", property_state: "TX", property_zip: "75023",
      property_type: "Single Family", property_condition: "Good", estimated_repairs: "5,000 - 10,000",
      reason_for_selling: "Divorce, need to liquidate", desired_timeline: "30 days",
      mortgage_status: "Current", notes: "Both parties want quick sale. ARV $420k, offered $340k.",
      lead_source: "divorce", status: "offer", created_at: "2026-07-22T13:15:00Z",
    },
    {
      full_name: "Sarah Johnson", email: "sarah.j@email.com", phone: "(972) 555-0808",
      property_address: "1890 Walnut Way", property_city: "Arlington", property_state: "TX", property_zip: "76010",
      property_type: "Single Family", property_condition: "Average", estimated_repairs: "12,000 - 18,000",
      reason_for_selling: "Vacant property, tired of paying taxes", desired_timeline: "ASAP",
      mortgage_status: "Paid off", notes: "Contract signed 7/21. Assignment fee $18,500. Buyer: CashFlow REI LLC.",
      lead_source: "vacant", status: "contract", created_at: "2026-07-15T09:00:00Z",
    },
    {
      full_name: "Thomas Brown", email: "tom.b@email.com", phone: "(512) 555-0909",
      property_address: "445 Pecan Drive", property_city: "Georgetown", property_state: "TX", property_zip: "78626",
      property_type: "Single Family", property_condition: "Fair", estimated_repairs: "20,000 - 30,000",
      reason_for_selling: "Absentee owner, tired of managing remotely", desired_timeline: "Closed",
      mortgage_status: "Paid off", notes: "Closed 7/14. Assignment fee $22,000. ARV $350k, sold at $275k.",
      lead_source: "absentee", status: "closed", created_at: "2026-07-01T10:30:00Z",
    },
    {
      full_name: "Karen Miller", email: "karen.m@email.com", phone: "(281) 555-1010",
      property_address: "900 Spruce Hollow", property_city: "Katy", property_state: "TX", property_zip: "77449",
      property_type: "Townhouse", property_condition: "Good", estimated_repairs: "3,000 - 5,000",
      reason_for_selling: "Expired listing, wants cash offer", desired_timeline: "Not urgent",
      mortgage_status: "Current", notes: "DNC — decided to stay. Listed with agent again. Not interested in cash offers.",
      lead_source: "expired-listing", status: "dead", created_at: "2026-06-28T16:45:00Z",
    },
  ];

  for (const lead of leads) {
    await sql`
      INSERT INTO leads (
        full_name, email, phone,
        property_address, property_city, property_state, property_zip,
        property_type, property_condition, estimated_repairs,
        reason_for_selling, desired_timeline, mortgage_status,
        notes, lead_source, status, created_at
      ) VALUES (
        ${lead.full_name}, ${lead.email}, ${lead.phone},
        ${lead.property_address}, ${lead.property_city}, ${lead.property_state}, ${lead.property_zip},
        ${lead.property_type}, ${lead.property_condition}, ${lead.estimated_repairs},
        ${lead.reason_for_selling}, ${lead.desired_timeline}, ${lead.mortgage_status},
        ${lead.notes}, ${lead.lead_source}, ${lead.status}, ${lead.created_at}::timestamptz
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Inserted ${leads.length} leads`);

  // Seed buyers (8 mock buyers)
  const buyers = [
    {
      name: "Austin Cash Flow LLC", email: "deals@austincashflow.com", phone: "(512) 555-1101",
      buying_criteria: JSON.stringify({
        preferredCities: ["Austin", "Round Rock", "Pflugerville"],
        preferredZips: ["78701", "78702", "78704", "78664", "78660"],
        maxPurchasePrice: 350000, propertyTypes: ["SFR", "Townhouse"],
        minBedrooms: 3, minBaths: 2, desiredROI: 12,
        notes: "Buy-and-hold investor. Prefers B-class neighborhoods near downtown Austin. Closing in 7-10 days, all cash.",
      }),
      created_at: "2026-06-15T10:00:00Z",
    },
    {
      name: "HTX Multi-Family Group", email: "acquisitions@htxmultifamily.com", phone: "(713) 555-2202",
      buying_criteria: JSON.stringify({
        preferredCities: ["Houston", "Katy", "Sugar Land"],
        preferredZips: ["77002", "77007", "77008", "77449", "77479"],
        maxPurchasePrice: 500000, propertyTypes: ["Multi-Family", "Commercial"],
        minBedrooms: 4, minBaths: 3, desiredROI: 15,
        notes: "Specializes in duplexes and small apartment buildings. Will look at value-add opportunities needing rehab.",
      }),
      created_at: "2026-06-20T14:00:00Z",
    },
    {
      name: "DFW Renovation Partners", email: "deals@dfwreno.com", phone: "(214) 555-3303",
      buying_criteria: JSON.stringify({
        preferredCities: ["Dallas", "Fort Worth", "Arlington", "Plano", "Garland"],
        preferredZips: ["75201", "76102", "76010", "75023", "75040"],
        maxPurchasePrice: 400000, propertyTypes: ["SFR", "Townhouse"],
        minBedrooms: 2, minBaths: 1, desiredROI: 18,
        notes: "Fix-and-flip specialist. Looking for distressed properties with 30%+ margins. Can close in 5 days.",
      }),
      created_at: "2026-07-01T09:30:00Z",
    },
    {
      name: "Alamo City Investments", email: "offers@alamocityinvestments.com", phone: "(210) 555-4404",
      buying_criteria: JSON.stringify({
        preferredCities: ["San Antonio", "New Braunfels"],
        preferredZips: ["78209", "78230", "78249", "78130"],
        maxPurchasePrice: 250000, propertyTypes: ["SFR"],
        minBedrooms: 3, minBaths: 2, desiredROI: 14,
        notes: "Long-term rental portfolio. Will consider homes needing moderate rehab. Prefers north side SA.",
      }),
      created_at: "2026-07-05T11:45:00Z",
    },
    {
      name: "Lone Star Buy & Hold", email: "deals@lonestarhold.com", phone: "(512) 555-5505",
      buying_criteria: JSON.stringify({
        preferredCities: ["Austin", "San Antonio", "Houston", "Dallas"],
        preferredZips: [],
        maxPurchasePrice: 300000, propertyTypes: ["SFR", "Multi-Family", "Townhouse"],
        minBedrooms: 2, minBaths: 1, desiredROI: 10,
        notes: "Statewide buyer. Looking for turnkey rentals or light rehab. 10+ properties in portfolio. Reliable closer.",
      }),
      created_at: "2026-07-10T16:20:00Z",
    },
    {
      name: "Cedar Park Fix & Flip Co", email: "deals@cedarparkflip.com", phone: "(512) 555-6606",
      buying_criteria: JSON.stringify({
        preferredCities: ["Cedar Park", "Leander", "Round Rock", "Georgetown"],
        preferredZips: ["78613", "78641", "78664", "78626"],
        maxPurchasePrice: 200000, propertyTypes: ["SFR"],
        minBedrooms: 3, minBaths: 2, desiredROI: 22,
        notes: "Aggressive fix-and-flipper. Buys heavily distressed properties. All cash, closes in 3-5 days.",
      }),
      created_at: "2026-07-15T08:00:00Z",
    },
    {
      name: "Metroplex Equity Group", email: "deals@metroplexequity.com", phone: "(469) 555-7707",
      buying_criteria: JSON.stringify({
        preferredCities: ["Dallas", "Plano", "Frisco", "McKinney", "Richardson"],
        preferredZips: ["75201", "75023", "75034", "75070", "75080"],
        maxPurchasePrice: 450000, propertyTypes: ["SFR", "Multi-Family", "Townhouse", "Condo"],
        minBedrooms: 2, minBaths: 2, desiredROI: 13,
        notes: "Institutional buyer. Prefers newer construction (post-2000). B-class+ neighborhoods only. 14-day close.",
      }),
      created_at: "2026-07-20T13:00:00Z",
    },
    {
      name: "Texas Land & Commercial", email: "acquisitions@txlandcommercial.com", phone: "(281) 555-8808",
      buying_criteria: JSON.stringify({
        preferredCities: ["Houston", "Austin", "Dallas", "Fort Worth", "San Antonio"],
        preferredZips: [],
        maxPurchasePrice: 500000, propertyTypes: ["Commercial", "Multi-Family", "Land"],
        minBedrooms: 0, minBaths: 0, desiredROI: 12,
        notes: "Commercial and land specialist. Looking for mixed-use, retail, and small apartment complexes. Joint venture partner.",
      }),
      created_at: "2026-07-22T10:30:00Z",
    },
  ];

  for (const buyer of buyers) {
    await sql`
      INSERT INTO buyers (name, email, phone, buying_criteria, created_at)
      VALUES (${buyer.name}, ${buyer.email}, ${buyer.phone}, ${buyer.buying_criteria}::jsonb, ${buyer.created_at}::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`Inserted ${buyers.length} buyers`);

  console.log("Seeding complete!");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
