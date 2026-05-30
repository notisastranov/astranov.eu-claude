// krypteia-audit — owner-only static auditor of the deployed AstranoV.
// Fetches the canonical index.html from https://astranov.eu and runs
// pattern checks for zombie / dead / contaminated / foreign code.
//
//   mode: 'scan'  → return categorised findings
//
// Findings are grouped by severity:
//   critical — eval-style dynamic execution, hard-coded secrets, plaintext http://
//   warn     — foreign third-party origins not in the allow-list,
//              base64 blobs > 500 chars, suspicious shells, debugger statements
//   info     — TODO/FIXME/HACK/XXX markers, console.* calls in production,
//              very long commented-out blocks (dead code candidates),
//              unknown localStorage keys
//
// The audit runs over the LIVE served bundle, which is what an attacker
// or contaminant would have already had to compromise to reach a user.
// Source files in /supabase/functions/ are not in scope here; those run
// server-side with their own audit lane.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const CANONICAL_URL = 'https://astranov.eu/'

// Origins that AstranoV legitimately uses. Anything else found in a
// <script src=>, <link href=>, <img src=>, fetch('https://…'), or
// other URL position is flagged. Cesium ion + CARTO + NASA + RSS
// upstreams + AI engines + sample mp4s.
const ALLOWED_ORIGINS = new Set([
  'astranov.eu', 'www.astranov.eu',
  'cesium.com', 'assets.ion.cesium.com', 'unpkg.com',
  'supabase.co', 'supabase.in',
  'gibs.earthdata.nasa.gov', 'earthdata.nasa.gov', 'visibleearth.nasa.gov',
  'openstreetmap.org', 'tile.openstreetmap.org', 'nominatim.openstreetmap.org',
  'overpass-api.de', 'overpass.kumi.systems', 'overpass.openstreetmap.fr',
  'maps.mail.ru',
  'basemaps.cartocdn.com', 'cartocdn.com',
  'services.arcgisonline.com',
  'tiles.stadiamaps.com',
  'tile.opentopomap.org',
  'generativelanguage.googleapis.com', 'api.anthropic.com', 'openrouter.ai', 'api.groq.com',
  'commondatastorage.googleapis.com',
  'feeds.bbci.co.uk', 'aljazeera.com', 'theguardian.com', 'rss.dw.com',
  'api.gdeltproject.org',
  'github.com', 'claude.ai', 'claude.com',
])

// Known localStorage keys this app legitimately reads/writes. Anything
// else is flagged so the owner can spot rogue persistence.
const KNOWN_LS_KEYS = new Set([
  'astranov_informants_v2',
  'astranov_user_id',
  'astranov_brightness',
  'astranov_brain_seed_done',
  'astranov_tts_voice',
  'astranov_lang',
  'astranov_layer',
  'astranov_seen_signals',
  'astranov_seen_deliveries',
  'astranov_mode',
])

interface Finding {
  severity: 'critical' | 'warn' | 'info'
  kind: string
  detail: string
  excerpt?: string
}

function pushUnique(arr: Finding[], f: Finding) {
  const k = f.severity + '|' + f.kind + '|' + (f.excerpt || f.detail)
  if (arr.some(x => x.severity + '|' + x.kind + '|' + (x.excerpt || x.detail) === k)) return
  arr.push(f)
}

function originOf(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null }
}
function isAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true
  for (const a of ALLOWED_ORIGINS) {
    if (origin === a || origin.endsWith('.' + a)) return true
  }
  return false
}

function snippet(src: string, idx: number, span = 80): string {
  const start = Math.max(0, idx - 30)
  const end = Math.min(src.length, idx + span)
  return src.slice(start, end).replace(/\s+/g, ' ').slice(0, 130)
}

function auditSource(src: string): Finding[] {
  const findings: Finding[] = []

  // ── CRITICAL — dynamic execution surface
  for (const pat of [
    { re: /\beval\s*\(/g,                    kind: 'dynamic-exec',  detail: 'eval() call' },
    { re: /\bnew\s+Function\s*\(/g,          kind: 'dynamic-exec',  detail: 'new Function() call' },
    { re: /\bdocument\.write\s*\(/g,         kind: 'dynamic-exec',  detail: 'document.write() call' },
    { re: /\bsetTimeout\s*\(\s*["'`][^"'`]+["'`]/g, kind: 'dynamic-exec', detail: 'setTimeout with string argument' },
    { re: /\bsetInterval\s*\(\s*["'`][^"'`]+["'`]/g, kind: 'dynamic-exec', detail: 'setInterval with string argument' },
    { re: /\bdebugger\b/g,                   kind: 'left-debugger', detail: 'debugger statement left in code' },
  ]) {
    let m: RegExpExecArray | null
    while ((m = pat.re.exec(src)) !== null) {
      pushUnique(findings, { severity: 'critical', kind: pat.kind, detail: pat.detail, excerpt: snippet(src, m.index) })
    }
  }

  // Hard-coded secret patterns
  for (const pat of [
    { re: /\b(sk_live_[A-Za-z0-9]{16,})/g,            kind: 'hardcoded-secret', detail: 'Stripe live secret key' },
    { re: /\b(sk-[A-Za-z0-9]{20,})\b/g,                kind: 'hardcoded-secret', detail: 'OpenAI/Anthropic-shape secret key' },
    { re: /\b(xoxb-[A-Za-z0-9-]{20,})\b/g,             kind: 'hardcoded-secret', detail: 'Slack bot token' },
    { re: /\b(AKIA[A-Z0-9]{16})\b/g,                   kind: 'hardcoded-secret', detail: 'AWS access key id' },
    { re: /\b(eyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,})\b/g, kind: 'hardcoded-jwt', detail: 'JWT-shape literal' },
    { re: /\bvcp_[A-Za-z0-9]{20,}\b/g,                 kind: 'hardcoded-secret', detail: 'Vercel token' },
    { re: /\bghp_[A-Za-z0-9]{20,}\b/g,                 kind: 'hardcoded-secret', detail: 'GitHub personal access token' },
  ]) {
    let m: RegExpExecArray | null
    while ((m = pat.re.exec(src)) !== null) {
      pushUnique(findings, { severity: 'critical', kind: pat.kind, detail: pat.detail, excerpt: m[0].slice(0, 24) + '…[redacted]' })
    }
  }

  // Plain-text http:// (excluding XML namespace URIs which are not network calls)
  {
    const re = /["'`]http:\/\/(?!www\.w3\.org)[^"'`\s)]+["'`]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      pushUnique(findings, { severity: 'critical', kind: 'plaintext-http', detail: 'plaintext http:// URL in source', excerpt: m[0] })
    }
  }

  // ── WARN — foreign origins
  {
    const re = /https?:\/\/([A-Za-z0-9_.-]+)/g
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const origin = m[1].toLowerCase().replace(/^www\./, '')
      if (seen.has(origin)) continue
      seen.add(origin)
      if (!isAllowed(origin)) {
        pushUnique(findings, { severity: 'warn', kind: 'foreign-origin', detail: `unrecognised origin: ${origin}` })
      }
    }
  }

  // Large base64 blobs — possible hidden payload or asset that should be a file
  {
    const re = /[A-Za-z0-9+/]{500,}={0,2}/g
    let m: RegExpExecArray | null
    let count = 0
    while ((m = re.exec(src)) !== null && count < 6) {
      pushUnique(findings, { severity: 'warn', kind: 'large-base64', detail: `${m[0].length}-char base64 blob`, excerpt: m[0].slice(0, 60) + '…' })
      count++
    }
  }

  // <iframe> — not used in AstranoV; any presence is suspicious
  {
    const re = /<iframe\b[^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      pushUnique(findings, { severity: 'warn', kind: 'foreign-iframe', detail: 'iframe element in source', excerpt: m[0].slice(0, 120) })
    }
  }

  // Tracker-style globals (analytics / ad networks)
  for (const pat of [
    { re: /\b(_gaq|gtag|fbq|googletag|_paq|hj|amplitude|mixpanel|segment|posthog|clarity)\b/g, kind: 'tracker-global', detail: 'analytics / ad tracker reference' },
  ]) {
    let m: RegExpExecArray | null
    while ((m = pat.re.exec(src)) !== null) {
      pushUnique(findings, { severity: 'warn', kind: pat.kind, detail: pat.detail, excerpt: m[0] })
    }
  }

  // ── INFO — hygiene markers
  for (const pat of [
    { re: /\b(TODO|FIXME|HACK|XXX)\b/g,        kind: 'work-marker',     detail: 'unfinished-work marker' },
    { re: /console\.(log|debug|info)\(/g,      kind: 'console-log',     detail: 'console.* call in production bundle' },
  ]) {
    let m: RegExpExecArray | null
    let count = 0
    while ((m = pat.re.exec(src)) !== null && count < 30) {
      pushUnique(findings, { severity: 'info', kind: pat.kind, detail: pat.detail, excerpt: snippet(src, m.index, 60) })
      count++
    }
  }

  // Long commented-out JS blocks (>400 chars) — dead-code candidates.
  // We restrict to /* … */ inside a <script> block so HTML comments
  // (which include the MASTER LAW) are excluded.
  {
    const scriptMatch = src.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)
    const jsBody = scriptMatch ? scriptMatch[1] : ''
    const re = /\/\*[\s\S]{400,}?\*\//g
    let m: RegExpExecArray | null
    let count = 0
    while ((m = re.exec(jsBody)) !== null && count < 6) {
      pushUnique(findings, {
        severity: 'info', kind: 'dead-comment-block',
        detail: `${m[0].length}-char block comment (possible dead code)`,
        excerpt: m[0].replace(/\s+/g, ' ').slice(0, 120) + '…',
      })
      count++
    }
  }

  // Unknown localStorage keys
  {
    const re = /localStorage\.(?:get|set|remove)Item\s*\(\s*['"]([^'"]+)['"]/g
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const key = m[1]
      if (seen.has(key)) continue
      seen.add(key)
      if (!KNOWN_LS_KEYS.has(key)) {
        pushUnique(findings, { severity: 'info', kind: 'unknown-ls-key', detail: `unknown localStorage key: ${key}` })
      }
    }
  }

  return findings
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode || 'scan'

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Owner gate
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
    if (!ownerId) return json({ error: 'Krypteia audit is owner-only.' }, 403)

    if (mode === 'scan') {
      const r = await fetch(CANONICAL_URL + '?cb=' + Date.now(), {
        headers: { 'User-Agent': 'Krypteia-Audit/1.0' },
      })
      if (!r.ok) return json({ ok: false, error: `fetch ${r.status}` }, 502)
      const src = await r.text()
      const findings = auditSource(src)
      const groups = { critical: 0, warn: 0, info: 0 } as Record<string, number>
      for (const f of findings) groups[f.severity]++
      return json({
        ok: true,
        scanned_at: new Date().toISOString(),
        source_url: CANONICAL_URL,
        source_size: src.length,
        counts: groups,
        findings,
        verdict: groups.critical > 0 ? 'critical findings present' :
                 groups.warn > 0     ? 'warnings present' :
                 'clean',
      })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
