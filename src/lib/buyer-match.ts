// DealFlow AI — Buyer matching (shared, PH1-B9)
//
// Single source of truth for buyer matching. Extracted from src/routes/buyers.tsx
// so the Calculator (src/routes/calculator.tsx) and the Buyers page reuse the
// exact same computeMatch against the live `buyers` table. Only the buy-box
// keys that exist today are used (city / zip / price / property type) — the
// B5 buyer-demand fields do not exist and are never rendered or invented.
//
// Honesty contract: matches are computed from real buyers in the database.
// When there are no buyers, no matchable deal, or no data, callers must show
// an honest empty state ("NOT VERIFIED / no buyer demand data") — never a
// fabricated buyer list.

export type PropertyType =
  | "SFR"
  | "Multi-Family"
  | "Commercial"
  | "Townhouse"
  | "Condo"
  | "Land";

export interface Buyer {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredCities: string[];
  preferredZips: string[];
  maxPurchasePrice: number;
  propertyTypes: PropertyType[];
  minBedrooms: number;
  minBaths: number;
  desiredROI: number;
  notes: string;
  createdAt: string;
}

export interface DealForMatch {
  id: string;
  leadName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  status: string;
  estimatedMAO: number;
  repairs: string;
}

export type MatchStrength = "strong" | "good" | "partial" | "none";

export interface BuyerMatch {
  buyer: Buyer;
  score: number;
  total: number;
  strength: MatchStrength;
  matchedOn: string[];
  missedOn: string[];
}

// --- DB Row Type ---
export interface BuyerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  buying_criteria: Record<string, unknown>;
  created_at: string;
}

// --- Mappers ---
export function rowToBuyer(row: BuyerRow): Buyer {
  const c = row.buying_criteria || {};
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    preferredCities: (c.preferredCities as string[]) || [],
    preferredZips: (c.preferredZips as string[]) || [],
    maxPurchasePrice: (c.maxPurchasePrice as number) || 0,
    propertyTypes: (c.propertyTypes as PropertyType[]) || [],
    minBedrooms: (c.minBedrooms as number) || 0,
    minBaths: (c.minBaths as number) || 0,
    desiredROI: (c.desiredROI as number) || 0,
    notes: (c.notes as string) || "",
    createdAt: String(row.created_at),
  };
}

export function buyerToCriteria(
  buyer: Omit<Buyer, "id" | "createdAt">,
): Record<string, unknown> {
  return {
    preferredCities: buyer.preferredCities,
    preferredZips: buyer.preferredZips,
    maxPurchasePrice: buyer.maxPurchasePrice,
    propertyTypes: buyer.propertyTypes,
    minBedrooms: buyer.minBedrooms,
    minBaths: buyer.minBaths,
    desiredROI: buyer.desiredROI,
    notes: buyer.notes,
  };
}

// --- Helpers ---

export const ALL_PROPERTY_TYPES: PropertyType[] = [
  "SFR",
  "Multi-Family",
  "Commercial",
  "Townhouse",
  "Condo",
  "Land",
];

export function normalizePropertyType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("single") || t === "sfr") return "SFR";
  if (t.includes("multi") || t.includes("duplex") || t.includes("apartment")) return "Multi-Family";
  if (t.includes("commercial")) return "Commercial";
  if (t.includes("town")) return "Townhouse";
  if (t.includes("condo")) return "Condo";
  if (t.includes("land")) return "Land";
  return type;
}

export function locationMatch(buyer: Buyer, deal: DealForMatch): boolean {
  if (buyer.preferredCities.length === 0 && buyer.preferredZips.length === 0) return true;
  const cityMatch = buyer.preferredCities.some(
    (c) => c.toLowerCase() === deal.propertyCity.toLowerCase(),
  );
  const zipMatch = buyer.preferredZips.some((z) => z === deal.propertyZip);
  return cityMatch || zipMatch;
}

export function priceMatch(buyer: Buyer, deal: DealForMatch): boolean {
  return deal.estimatedMAO <= buyer.maxPurchasePrice;
}

export function propertyTypeMatch(buyer: Buyer, deal: DealForMatch): boolean {
  if (buyer.propertyTypes.length === 0) return true;
  const normalizedDealType = normalizePropertyType(deal.propertyType);
  return buyer.propertyTypes.some((pt) => pt === normalizedDealType);
}

export function computeMatch(buyer: Buyer, deal: DealForMatch): BuyerMatch {
  const matchedOn: string[] = [];
  const missedOn: string[] = [];

  if (locationMatch(buyer, deal)) {
    matchedOn.push("Location");
  } else {
    missedOn.push("Location");
  }

  if (priceMatch(buyer, deal)) {
    matchedOn.push("Price");
  } else {
    missedOn.push("Price");
  }

  if (propertyTypeMatch(buyer, deal)) {
    matchedOn.push("Property Type");
  } else {
    missedOn.push("Property Type");
  }

  const score = matchedOn.length;
  const total = 3;

  let strength: MatchStrength = "none";
  if (score === 3) strength = "strong";
  else if (score === 2) strength = "good";
  else if (score === 1) strength = "partial";

  return { buyer, score, total, strength, matchedOn, missedOn };
}
