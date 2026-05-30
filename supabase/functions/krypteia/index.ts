// krypteia — the unified Krypteia run. Owner-only.
// One call replaces three: audit + watchtower + threat-log. Then hands
// everything to /developer (Claude opus-4-7) for triage and returns a
// single verdict object the client can act on.
//
// Verdict shape:
//   { ok, severity: 'clear'|'low'|'medium'|'high'|'critical',
//     summary: <one-paragraph human readable>,
//     claude:  <full Claude DIAGNOSIS / DIFF / COMMAND / RISK text>,
//     audit:   <raw audit findings>,
//     watch:   <raw watchtower hits>,
//     threats: <recent security_events>,
//     owner_approval_required: bool,
//     silent_ok: bool,
//     at }
//
// Krypteia operates under PERPETUAL OWNER AUTHORIZATION (MASTER LAW
// §10d). This function runs server-side, owner-gated, and surfaces a
// panel to the owner only when severity demands it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

interface Verdict {
  ok: boolean
  severity: 'clear' | 'low' | 'medium' | 'high' | 'critical'
  summary: string
  claude: string
  audit?: unknown
  watch?: unknown
  threats?: unknown
  owner_approval_required: boolean
  silent_ok: boolean
  at: string
}

async function callFn(req: Request, fn: string, body: unknown): Promise<unknown> {
  const url = `${Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/${fn}`
  const auth = req.headers.get('Authorization') || ''
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode || 'scan'

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

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
    if (!ownerId) return json({ error: 'Krypteia answers only to the owner.' }, 403)

    if (mode === 'scan') {
      // Run the three Krypteia eyes in parallel.
      const [auditR, watchR, threatsR] = await Promise.all([
        callFn(req, 'krypteia-audit', { mode: 'scan' }),
        callFn(req, 'krypteia-watch', { mode: 'scan' }),
        sb.from('security_events').select('*').order('created_at', { ascending: false }).limit(15),
      ])
      const audit   = (auditR as Record<string, unknown> | null) || {}
      const watch   = (watchR as Record<string, unknown> | null) || {}
      const threats = (threatsR as { data?: unknown[] }).data || []

      // Build the context blob for Claude.
      const ctx = JSON.stringify({ audit, watch, threats }, null, 2).slice(0, 14000)

      // Hand to Claude (the developer channel) for triage.
      const claudeR = await callFn(req, 'developer', {
        request: `Krypteia composite check just ran. Tell me:
(a) ONE-PARAGRAPH SUMMARY of system health.
(b) For each non-clean finding, the exact action you'd take.
(c) SEVERITY of the overall situation: clear / low / medium / high / critical.
(d) OWNER_APPROVAL_REQUIRED: yes only if anything in the findings could change the owner's published code, push a commit, contact a third party (DMCA / takedown), or alter user data. Otherwise NO — Krypteia operates under perpetual authorization and acts silently.
End your reply with a single line:
SEVERITY=<clear|low|medium|high|critical>; OWNER_APPROVAL=<yes|no>`,
        context: ctx,
      }) as { text?: string; error?: string } | null

      const claudeText = (claudeR && claudeR.text) || ''
      // Parse the final-line directives Claude was asked to emit.
      let severity: Verdict['severity'] = 'clear'
      let ownerApprovalRequired = false
      const tail = claudeText.split(/\n/).reverse().find(l => /SEVERITY=/i.test(l)) || ''
      const sm = tail.match(/SEVERITY=(clear|low|medium|high|critical)/i)
      if (sm) severity = sm[1].toLowerCase() as Verdict['severity']
      if (/OWNER_APPROVAL=yes/i.test(tail)) ownerApprovalRequired = true

      // Backstop: hard-trigger owner approval on any critical audit finding
      // or any watchtower hit, regardless of what Claude said.
      const auditCounts = (audit as { counts?: Record<string, number> }).counts || {}
      const watchHits = (watch as { hits_count?: number }).hits_count || 0
      if ((auditCounts.critical || 0) > 0) { severity = 'critical'; ownerApprovalRequired = true }
      if (watchHits > 0 && severity === 'clear') severity = 'medium'
      if (watchHits > 0) ownerApprovalRequired = true

      const verdict: Verdict = {
        ok: true,
        severity,
        summary: claudeText.split(/\n/).slice(0, 4).join(' ').slice(0, 600),
        claude: claudeText,
        audit, watch, threats,
        owner_approval_required: ownerApprovalRequired,
        silent_ok: !ownerApprovalRequired && (severity === 'clear' || severity === 'low'),
        at: new Date().toISOString(),
      }

      // Persist a row so the owner can see Krypteia's silent history.
      try {
        await sb.from('security_events').insert({
          severity: severity === 'clear' ? 'info' : (severity === 'critical' ? 'critical' : 'warning'),
          kind: 'krypteia_run',
          status: ownerApprovalRequired ? 'open' : 'resolved',
          details: { severity, owner_approval_required: ownerApprovalRequired, summary: verdict.summary },
        })
      } catch { /* table may have RLS quirks; non-fatal */ }

      return json(verdict)
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
