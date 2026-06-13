// Krypteia Watchtower — owner-only IP-defence scanner.
// Hunts GitHub code search for the distinctive AstranoV fingerprints and
// returns hits not in the canonical repo. The owner reviews the list;
// clear violations are escalated to the Council of Thirteen via the
// /council Edge Function, then to formal DMCA / cease-and-desist.
//
//   mode: 'scan'   → run a fresh scan, return hits
//         'list'   → just return the fingerprint catalogue we hunt for
//
// This function makes only public, read-only requests to api.github.com
// (no token required for code search at low rate, optional GITHUB_TOKEN
// for higher rate). No mutation of any external system.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Distinctive fingerprints — strings unique enough that a hit elsewhere on
// GitHub strongly suggests a lift. Keep them long and rare.
const FINGERPRINTS = [
  'Agentic Orbital Operating System',
  'AstranoV',
  'Living-Orb Graphics Engine',
  '_INFORMANT_VIDEO_CATALOG',
  '_computeOrbAnchorsLatLon',
  'EllipsoidalOccluder.+isPointVisible.+orb',
  'Council of Thirteen',
  'AICYCLE',
  'AstranoV Orbital License',
  '_refreshOrbAnchors',
]

// We exclude the canonical repository from results so the owner only sees
// off-repo hits.
const CANONICAL_OWNER = 'notisastranov'
const CANONICAL_REPO = 'astranov'

async function ghSearch(q: string, token: string | null): Promise<unknown[]> {
  const url = `https://api.github.com/search/code?per_page=20&q=${encodeURIComponent(q)}`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Krypteia-Watch/1.0 (AstranoV)',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const r = await fetch(url, { headers })
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j.items) ? j.items : []
  } catch { return [] }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode || 'scan'

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Owner gate — the Watchtower is sovereign-only.
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
    if (!ownerId) return json({ error: 'The Watchtower answers only to the owner.' }, 403)

    if (mode === 'list') {
      return json({ ok: true, fingerprints: FINGERPRINTS })
    }

    if (mode === 'scan') {
      const ghToken = Deno.env.get('GITHUB_TOKEN') || null
      const all: { fingerprint: string; repo: string; path: string; html_url: string; sha: string }[] = []
      for (const fp of FINGERPRINTS) {
        const items = await ghSearch(`"${fp}"`, ghToken) as Record<string, unknown>[]
        for (const it of items) {
          const repo = (it.repository as { full_name?: string })?.full_name || ''
          if (repo === `${CANONICAL_OWNER}/${CANONICAL_REPO}`) continue // canonical = us, skip
          all.push({
            fingerprint: fp,
            repo,
            path: String(it.path || ''),
            html_url: String(it.html_url || ''),
            sha: String(it.sha || ''),
          })
        }
        // Throttle so we stay under GitHub's rate limit even unauthenticated.
        await new Promise(r => setTimeout(r, 1100))
      }
      // De-dupe by html_url, keep the most distinctive fingerprint per hit.
      const byUrl = new Map<string, typeof all[number]>()
      for (const h of all) {
        const prev = byUrl.get(h.html_url)
        if (!prev || h.fingerprint.length > prev.fingerprint.length) byUrl.set(h.html_url, h)
      }
      const hits = [...byUrl.values()]
      return json({
        ok: true,
        scanned_at: new Date().toISOString(),
        fingerprints_used: FINGERPRINTS.length,
        hits_count: hits.length,
        hits,
        note: hits.length
          ? 'Review each hit. Clear violations should be escalated to the Council of Thirteen via /council, then to DMCA / cease-and-desist.'
          : 'No off-canonical occurrences detected.',
      })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
