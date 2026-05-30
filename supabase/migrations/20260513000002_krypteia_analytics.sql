-- AstranoV: krypteia_log + analytics_events tables

CREATE TABLE IF NOT EXISTS krypteia_log (
  id         bigserial PRIMARY KEY,
  ts         bigint NOT NULL,
  type       text NOT NULL,   -- self_check | develop | inspect | export
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS krypteia_log_ts_idx ON krypteia_log(ts DESC);
CREATE INDEX IF NOT EXISTS krypteia_log_type_idx ON krypteia_log(type);

ALTER TABLE krypteia_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role krypteia_log all" ON krypteia_log;
CREATE POLICY "Service role krypteia_log all"
  ON krypteia_log FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anon insert krypteia_log" ON krypteia_log;
CREATE POLICY "Anon insert krypteia_log"
  ON krypteia_log FOR INSERT
  WITH CHECK (true);


CREATE TABLE IF NOT EXISTS analytics_events (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  ts         bigint NOT NULL,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(type);
CREATE INDEX IF NOT EXISTS analytics_events_ts_idx   ON analytics_events(ts DESC);
CREATE INDEX IF NOT EXISTS analytics_events_sid_idx  ON analytics_events(session_id);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role analytics all" ON analytics_events;
CREATE POLICY "Service role analytics all"
  ON analytics_events FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anon insert analytics" ON analytics_events;
CREATE POLICY "Anon insert analytics"
  ON analytics_events FOR INSERT
  WITH CHECK (true);
