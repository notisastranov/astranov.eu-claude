-- Export cic_logs as JSONL the prepare_corpus.py script consumes.
-- Run via psql:
--   psql "$DATABASE_URL" -At -f export_cic.sql > cic_logs.jsonl
--
-- We keep only:
--   - logs of length >= 12 chars (filter junk),
--   - replies that look like real Astranov voice (no error markers),
--   - the most recent N rows so each release trains on fresh material.

SELECT jsonb_build_object(
  'messages', jsonb_build_array(
    jsonb_build_object('role', 'user',      'content', LEFT(query,    2000)),
    jsonb_build_object('role', 'assistant', 'content', LEFT(response, 2000))
  )
)::text
FROM public.cic_logs
WHERE COALESCE(LENGTH(query), 0) >= 12
  AND COALESCE(LENGTH(response), 0) >= 12
  AND response NOT ILIKE '%Brain unreachable%'
  AND response NOT ILIKE '%Something went wrong%'
ORDER BY created_at DESC
LIMIT 50000;
