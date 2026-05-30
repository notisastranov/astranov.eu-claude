-- AstranoV Collective Intelligence Cycle: human-answerable queue
-- When the Astranov C.I. needs human or architect input, the question lands here.

CREATE TABLE IF NOT EXISTS cic_queue (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  question     text NOT NULL,
  context      jsonb DEFAULT '{}',
  reason       text,                            -- why it was queued (uncertainty / owner-only / etc.)
  status       text NOT NULL DEFAULT 'open',    -- open | answered | dismissed
  answered_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answer       text,
  for_owner    boolean NOT NULL DEFAULT false,  -- true = only the architect should answer
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);

CREATE INDEX IF NOT EXISTS cic_queue_status_idx ON cic_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS cic_queue_owner_idx ON cic_queue(for_owner, status);

ALTER TABLE cic_queue ENABLE ROW LEVEL SECURITY;

-- Authenticated users can post a question to the collective
DROP POLICY IF EXISTS "Authed insert cic_queue" ON cic_queue;
CREATE POLICY "Authed insert cic_queue"
  ON cic_queue FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Anyone authenticated can read open non-owner questions
DROP POLICY IF EXISTS "Authed read open cic_queue" ON cic_queue;
CREATE POLICY "Authed read open cic_queue"
  ON cic_queue FOR SELECT
  USING (auth.uid() IS NOT NULL AND (for_owner = false OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_owner = true)));

-- Authors can read their own (even owner-only) questions
DROP POLICY IF EXISTS "Authors read own cic_queue" ON cic_queue;
CREATE POLICY "Authors read own cic_queue"
  ON cic_queue FOR SELECT
  USING (user_id = auth.uid());

-- Authenticated users can answer (update) open questions; owner-only ones only by owner
DROP POLICY IF EXISTS "Collective answers cic_queue" ON cic_queue;
CREATE POLICY "Collective answers cic_queue"
  ON cic_queue FOR UPDATE
  USING (auth.uid() IS NOT NULL AND status = 'open' AND (for_owner = false OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_owner = true)));

DROP POLICY IF EXISTS "Service role cic_queue all" ON cic_queue;
CREATE POLICY "Service role cic_queue all"
  ON cic_queue FOR ALL
  USING (auth.role() = 'service_role');
