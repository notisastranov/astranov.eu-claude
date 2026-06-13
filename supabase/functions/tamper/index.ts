// tamper v2 — fixed: writes status='resolved' instead of 'closed'
// (the security_events CHECK constraint only allows open|resolved|dismissed).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const ALLOWED_KINDS = new Set([
  'select-all', 'copy', 'cut', 'paste', 'copy-event',
  'view-source', 'save-page', 'print',
  'devtools-f12', 'devtools-i', 'devtools-c', 'devtools-j',
  'contextmenu', 'drag-image', 'devtools-open-heuristic',
  'camera-verify-accepted', 'camera-verify-declined', 'camera-verify-snapshot',
  'krypteia-heartbeat',
])

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const rawKind: string = String(body.kind || '').slice(0, 60)
    if (!ALLOWED_KINDS.has(rawKind)) return json({ error: 'unknown kind' }, 400)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let profileId: string | null = null
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token && token !== anonKey) {
      try { const { data: ud } = await sb.auth.getUser(token); if (ud?.user) profileId = ud.user.id } catch (_) {}
    }

    const ipRaw = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    const ip = ipRaw.split(',')[0].trim().slice(0, 64)
    const ua = (req.headers.get('user-agent') || '').slice(0, 300)

    const detail = {
      kind: rawKind, ip, ua,
      ts: new Date().toISOString(),
      profile_id: profileId,
      lang: String(body.lang || '').slice(0, 16),
      screen: String(body.screen || '').slice(0, 24),
      page: String(body.page || '').slice(0, 200),
      count: typeof body.count === 'number' ? body.count : 0,
      sample: typeof body.sample === 'string' ? body.sample.slice(0, 400) : undefined,
    }

    const severity =
      rawKind.startsWith('camera-verify') ? 'info' :
      rawKind === 'krypteia-heartbeat'   ? 'info' :
      detail.count >= 3                  ? 'warning' :
      'info'

    // FIX: status enum allows {open|resolved|dismissed}, not 'closed'.
    // Open = needs owner triage (count >= 3); resolved = logged-and-fine.
    const status = severity === 'warning' ? 'open' : 'resolved'

    try {
      await sb.from('security_events').insert({
        severity, kind: 'tamper_' + rawKind, status, details: detail,
        actor_id: profileId,
      })
    } catch (_) { /* non-fatal */ }
    return json({ ok: true, logged: true, count: detail.count })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
