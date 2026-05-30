-- AstranoV Invoices table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS invoices (
  id            text PRIMARY KEY,            -- same as mark: INV-YYYY-MM-NNNNNN
  order_id      text,
  vendor_name   text,
  buyer_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mark          text UNIQUE NOT NULL,        -- local sequential MARK
  mydata_mark   text,                        -- AADE myDATA MARK when submitted
  items         jsonb NOT NULL DEFAULT '[]',
  subtotal      numeric(10,2) NOT NULL,
  delivery_fee  numeric(10,2) NOT NULL DEFAULT 0,
  platform_fee  numeric(10,2) NOT NULL DEFAULT 0,
  vat_food      numeric(5,4) NOT NULL DEFAULT 0.13,   -- 13% on food
  vat_service   numeric(5,4) NOT NULL DEFAULT 0.24,   -- 24% on delivery/platform
  total         numeric(10,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'AVC',
  issued_at     timestamptz NOT NULL DEFAULT now(),
  period_month  text NOT NULL,               -- YYYY-MM for monthly aggregation
  status        text NOT NULL DEFAULT 'issued'  -- issued | submitted | voided
);

-- Index for monthly reporting
CREATE INDEX IF NOT EXISTS invoices_period_idx ON invoices(period_month);
CREATE INDEX IF NOT EXISTS invoices_buyer_idx  ON invoices(buyer_id);
CREATE INDEX IF NOT EXISTS invoices_issued_idx ON invoices(issued_at DESC);

-- RLS: users see their own invoices; service role sees all
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own invoices"
  ON invoices FOR SELECT
  USING (buyer_id = auth.uid());

CREATE POLICY "Service role full access"
  ON invoices FOR ALL
  USING (auth.role() = 'service_role');

-- Allow authenticated inserts (app writes invoices on order close)
CREATE POLICY "Auth insert invoices"
  ON invoices FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- Helper: add_balance RPC (used by astranov-api /balance/recharge)
CREATE OR REPLACE FUNCTION add_balance(uid uuid, delta numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE balance_ledger SET balance = balance + delta WHERE user_id = uid;
  IF NOT FOUND THEN
    INSERT INTO balance_ledger(user_id, balance) VALUES (uid, delta);
  END IF;
END;
$$;
