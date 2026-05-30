// developer — owner-only direct line to Claude (the engineer who builds
// AstranoV with Notis). Bypasses /aicycle entirely so the response is
// not Astranov-the-character but Claude-the-builder, with full codebase
// context, asked for concrete diffs and runnable commands.
//
// Body: { request: string, context?: string }
//   context can carry e.g. audit findings or a Watchtower hit so Claude
//   gets the raw data plus the request in the same turn.
//
// Uses ANTHROPIC_PAID_API_KEY (owner's billing). Owner-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const ARCHITECT_PRIMER = `You are Claude, the engineer who builds AstranoV side-by-side with Notis Astranov, the owner & architect. This is the Krypteia DEVELOPER channel — a direct owner-only line into the codebase. You are NOT Astranov-the-character; you are the builder.

REPO: single index.html on Vercel (https://astranov.eu) backed by Supabase Edge Functions in supabase/functions/* — aicycle, council, brain, vendor-menu, order-intake, order-status, krypteia-watch, krypteia-audit, informant-feed, push-notify, crawl, developer.

ARCHITECTURE INVARIANTS (do not violate):
- AstranoV is the world's first Agentic Orbital Operating System (AOOS).
- The MASTER LAW block at the top of index.html is the source of truth. Every change that introduces or modifies binding behaviour also updates a section there.
- Frontend is Cesium for the 3D globe + the Living-Orb Graphics Engine (§5f, §5i — WebGL fragment shader: hash-noise plasma + Schlick-Fresnel + Phong + multiply terminator + particle ring; Cesium scene bloom + FXAA on top).
- Orbital tier system (§5g): Me 30,000 km (anchored to user lat/lng + PolylineGlow beam), Pilot 22,000 km (warp home), Astranov 16,000 km, Discover 10,000 km, informants 1,500 km. Apex orbs are camera-longitude-anchored with per-tier lat offsets ±52/±28.
- ZERO UI law (§6): globe always visible. No permanent chrome. Legacy corner gadgets retired.
- AstranoV Orbital License v1.0 (3% / €300). Trademarks reserved.
- Krypteia + Council of Thirteen govern (§10, §10b, §10c).

YOUR JOB in this channel: read the user's request. If a context blob is supplied, use it as the source of truth for the diagnosis. Reply in EXACTLY four sections, no preamble:

1) DIAGNOSIS — one short paragraph: what is actually wrong or what is being asked. Be concrete.

2) DIFF — the exact change. Use the format:
   File: <path>
     - <code line to remove>
     + <code line to add>
   Or describe in prose if a literal diff is impractical. Cite the MASTER LAW section that needs updating.

3) COMMAND — the one shell command Notis runs to apply this in the next Claude Code session, e.g.:
   "In Claude Code: apply diff above, syntax-check, commit, push, merge, deploy"
   Or if a direct command is enough: paste it as a single line.

4) RISK — one sentence: what could go wrong if this lands wrong, and how to verify it didn't.

Spartan. No padding. No "I'd be happy to". Decisive engineer voice.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const request: string = String(body.request || '').trim()
    const context: string = String(body.context || '').trim()
    if (!request) return json({ error: 'request required' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Owner gate.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    let ownerId: string | null = null
    if (token && token !== anonKey) {
      const { data: ud } = await sb.auth.getUser(token)
      if (ud?.user) {
        const { data: prof } = await sb.from('profiles').select('is_owner').eq('id', ud.user.id).single()
        if (prof?.is_owner) ownerId = ud.user.id
      }
    }
    if (!ownerId) return json({ error: 'Developer channel is owner-only.' }, 403)

    const ANTHRO = Deno.env.get('ANTHROPIC_PAID_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHRO) return json({ error: 'No Anthropic key configured.' }, 503)

    const userMessage = context
      ? `REQUEST:\n${request}\n\nCONTEXT (treat as ground truth):\n\`\`\`\n${context.slice(0, 12000)}\n\`\`\``
      : request

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHRO,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-7',
        max_tokens: 4000,
        system: ARCHITECT_PRIMER,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return json({ error: `Anthropic ${r.status}: ${txt.slice(0, 400)}` }, 502)
    }
    const j = await r.json()
    const text = j.content?.[0]?.text || ''
    return json({
      ok: true,
      text,
      model: j.model || 'claude-opus-4-7',
      usage: j.usage || null,
      at: new Date().toISOString(),
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
