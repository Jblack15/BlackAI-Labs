-- DealFlow AI — Migration 003: Contracts table
-- Supports contract generation for purchase agreements and assignment contracts.

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  buyer_id UUID REFERENCES buyers(id),
  contract_type TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  purchase_price NUMERIC,
  assignment_fee NUMERIC,
  earnest_money NUMERIC DEFAULT 1000,
  closing_date DATE,
  contract_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_lead_id ON contracts (lead_id);
CREATE INDEX IF NOT EXISTS idx_contracts_buyer_id ON contracts (buyer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status);
