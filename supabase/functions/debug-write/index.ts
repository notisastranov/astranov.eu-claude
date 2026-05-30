// debug-write — receives error payload from browser, writes to public storage
// via service-role (bypasses RLS). Claude reads the public URL with no auth.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const payload = await req.json().catch(() => ({}))
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Ensure bucket exists (idempotent)
    await sb.storage.createBucket('debug-pub', { public: true }).catch(() => {})

    const body = JSON.stringify({
      received_at: new Date().toISOString(),
      ...payload
    }, null, 2)

    const blob = new Blob([body], { type: 'application/json' })

    // Upsert errors.json (latest snapshot from this session)
    const { error: e1 } = await sb.storage
      .from('debug-pub')
      .upload('errors.json', blob, { contentType: 'application/json', upsert: true })

    // Also append a timestamped copy for history
    const sid = payload.session || 'unknown'
    const fname = `sessions/${sid}-${Date.now()}.json`
    await sb.storage.from('debug-pub').upload(fname, blob, { contentType: 'application/json', upsert: true }).catch(() => {})

    return new Response(JSON.stringify({ ok: true, file: 'errors.json', error: e1?.message ?? null }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors })
  }
})
