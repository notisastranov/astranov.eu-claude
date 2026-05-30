-- AstranoV vendors + balance_ledger tables (referenced by app + edge functions)

CREATE TABLE IF NOT EXISTS vendors (
  id              text PRIMARY KEY,
  owner_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text NOT NULL,
  emoji           text,
  country         text,
  city            text,
  lat             double precision,
  lng             double precision,
  items           jsonb NOT NULL DEFAULT '[]',
  reserve_balance numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendors_owner_idx ON vendors(owner_id);
CREATE INDEX IF NOT EXISTS vendors_geo_idx   ON vendors(country, city);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read vendors" ON vendors;
CREATE POLICY "Public read vendors"
  ON vendors FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Owner insert vendor" ON vendors;
CREATE POLICY "Owner insert vendor"
  ON vendors FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner update vendor" ON vendors;
CREATE POLICY "Owner update vendor"
  ON vendors FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Service role vendors all" ON vendors;
CREATE POLICY "Service role vendors all"
  ON vendors FOR ALL
  USING (auth.role() = 'service_role');


CREATE TABLE IF NOT EXISTS balance_ledger (
  user_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance   numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE balance_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own balance" ON balance_ledger;
CREATE POLICY "Users see own balance"
  ON balance_ledger FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role balance all" ON balance_ledger;
CREATE POLICY "Service role balance all"
  ON balance_ledger FOR ALL
  USING (auth.role() = 'service_role');
