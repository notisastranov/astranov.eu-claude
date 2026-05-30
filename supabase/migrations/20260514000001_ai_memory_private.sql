-- AstranoV: split ai_memory into public (AI context) and private (owner-only, never sent to AI)

ALTER TABLE ai_memory ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_memory_private_idx ON ai_memory(user_id, is_private, created_at DESC);

-- Owners can update their own memory rows to toggle privacy
DROP POLICY IF EXISTS "Users update own ai memory" ON ai_memory;
CREATE POLICY "Users update own ai memory"
  ON ai_memory FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
