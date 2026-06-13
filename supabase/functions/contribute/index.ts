// contribute — the compute-donation coordinator for the Anonymous
// Service. Users opt-in to donate spare device cycles to the AstranoV
// collective; in return they earn AVC (next-turn link) and unlock
// privacy-focused advanced features.
//
// SCAFFOLD ONLY (today): the worker on the client computes SHA-256
// chains for a target prefix (proof-of-work style benchmark, not real
// money mining). Each ping here records cycles donated. The AVC payout
// loop lands in the next turn alongside Stripe.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = String(body.mode || 'ping')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let profileId: string | null = null
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token && token !== anonKey) {
      try { const { data: ud } = await sb.auth.getUser(token); if (ud?.user) profileId = ud.user.id } catch (_) {}
    }

    if (mode === 'workunit') {
      const target = Math.random().toString(36).slice(2, 8)
      const difficulty = Math.max(10_000, Math.min(2_000_000, Number(body.difficulty) || 200_000))
      return json({ ok: true, target, difficulty, ts: Date.now() })
    }

    if (mode === 'ping') {
      const cycles = Math.max(0, Math.min(50_000_000, Number(body.cycles) || 0))
      const duration_ms = Math.max(0, Math.min(120_000, Number(body.duration_ms) || 0))
      const anon_id = String(body.anon_id || '').slice(0, 64)
      try {
        await sb.from('compute_contributions').insert({
          profile_id: profileId,
          anon_id: profileId ? null : (anon_id || null),
          cycles, duration_ms,
          ua: (req.headers.get('user-agent') || '').slice(0, 200),
        })
      } catch (_) { /* non-fatal */ }
      const avc_estimate = +(cycles / 5_000_000).toFixed(4)
      return json({ ok: true, recorded: true, avc_estimate, ts: Date.now() })
    }

    if (mode === 'stats') {
      let cyclesTotal = 0, pings = 0
      try {
        if (profileId) {
          const { data } = await sb.from('compute_contributions')
            .select('cycles')
            .eq('profile_id', profileId)
          for (const r of (data || [])) cyclesTotal += Number((r as { cycles: number }).cycles || 0)
          pings = (data || []).length
        }
      } catch (_) {}
      return json({ ok: true, cycles_total: cyclesTotal, pings, avc_estimate: +(cyclesTotal / 5_000_000).toFixed(4) })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
