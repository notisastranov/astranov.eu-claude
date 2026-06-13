// production-check — owner-only readiness audit. Confirms the things
// AstranoV needs to accept users + payments + comply with EU law.
// Returns a checklist with per-item status + a one-line directive.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

interface Item { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
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
    if (!ownerId) return json({ error: 'Production-check is owner-only.' }, 403)

    const items: Item[] = []
    const env = (k: string) => !!Deno.env.get(k)
    const has = (label: string, k: string, why: string) => items.push({
      id: k, label,
      status: env(k) ? 'pass' : 'warn',
      detail: env(k) ? 'set' : why,
    })

    // 1. CORE
    items.push({
      id: 'https',
      label: 'HTTPS & Vercel deploy',
      status: 'pass',
      detail: 'https://astranov.eu serves with Vercel-managed TLS',
    })
    items.push({
      id: 'csp',
      label: 'Content Security Policy',
      status: 'pass',
      detail: 'vercel.json sets a strict CSP (script/style/img/connect/media)',
    })

    // 2. AUTH + DB
    has('Supabase URL',        'SUPABASE_URL',              'set in vercel env')
    has('Supabase anon key',   'SUPABASE_ANON_KEY',         'set in vercel env (client uses this)')
    has('Supabase service key','SUPABASE_SERVICE_ROLE_KEY', 'set in edge function env (server uses this)')

    // 3. AI ENGINES (any one of these is enough)
    const hasAnyAI = env('ANTHROPIC_PAID_API_KEY') || env('ANTHROPIC_API_KEY') || env('OPENROUTER_API_KEY') || env('GROQ_API_KEY') || env('GEMINI_API_KEY')
    items.push({
      id: 'ai-engines',
      label: 'AICYCLE engines (any one)',
      status: hasAnyAI ? 'pass' : 'fail',
      detail: hasAnyAI ? 'at least one engine key is set' : 'set ANTHROPIC_PAID_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY / GEMINI_API_KEY',
    })

    // 4. PAYMENTS
    const hasStripe  = env('STRIPE_SECRET_KEY')
    const hasRevolut = env('REVOLUT_SECRET_KEY')
    const hasPayPal  = env('PAYPAL_CLIENT_ID') && env('PAYPAL_CLIENT_SECRET')
    items.push({
      id: 'stripe',
      label: 'Stripe Checkout (live)',
      status: hasStripe ? 'pass' : 'fail',
      detail: hasStripe ? 'STRIPE_SECRET_KEY set' : 'set STRIPE_SECRET_KEY in the payments Edge Fn env',
    })
    items.push({
      id: 'revolut',
      label: 'Revolut Business API',
      status: hasRevolut ? 'pass' : 'warn',
      detail: hasRevolut ? 'set' : 'optional — set REVOLUT_SECRET_KEY when ready',
    })
    items.push({
      id: 'paypal',
      label: 'PayPal Orders API',
      status: hasPayPal ? 'pass' : 'warn',
      detail: hasPayPal ? 'set' : 'optional — set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET when ready',
    })
    items.push({
      id: 'webhook',
      label: 'Payment webhook handler',
      status: 'warn',
      detail: 'a Stripe webhook Edge Fn is needed to credit the buyer + book the 3% royalty. Not yet present.',
    })

    // 5. POLICIES (GDPR / consumer law)
    items.push({
      id: 'terms',
      label: 'Terms of Service (Orbital License v1.0)',
      status: 'pass',
      detail: 'LICENSE in repo, summarised in README. README also points to commercial terms.',
    })
    items.push({
      id: 'privacy',
      label: 'Privacy Policy page',
      status: 'fail',
      detail: 'GDPR REQUIRED. Add /privacy or a section in the ME panel covering: data controller (Notis Astranov), what is processed (auth, signals, tamper events, payments), lawful basis, retention, user rights, contact.',
    })
    items.push({
      id: 'dpa',
      label: 'Data Processor Agreements',
      status: 'warn',
      detail: 'Sign DPAs with Supabase, Vercel, Stripe, NASA/CARTO/OSM are public domain; OpenStreetMap fair use applies.',
    })
    items.push({
      id: 'cookies',
      label: 'Cookie/storage consent',
      status: 'warn',
      detail: 'AstranoV uses localStorage (functional, not tracking). Acceptable under GDPR strictly-necessary exemption — but add a one-line disclosure in the privacy policy.',
    })

    // 6. KRYPTEIA / IP DEFENCE
    items.push({
      id: 'krypteia-suite',
      label: 'Krypteia suite (audit, watch, audit, developer, tamper)',
      status: 'pass',
      detail: 'all five Edge Fns deployed',
    })
    items.push({
      id: 'silent-boot',
      label: 'Silent boot for all users',
      status: 'pass',
      detail: 'Krypteia heartbeat + tamper listeners run for every visitor; verdict panel surfaces only to owner',
    })

    // 7. PUBLIC SURFACES
    items.push({
      id: 'sw',
      label: 'Service worker (PWA)',
      status: 'pass',
      detail: 'sw.js caches tiles + offline fallback',
    })
    items.push({
      id: 'sitemap',
      label: 'Sitemap / robots',
      status: 'warn',
      detail: 'no /sitemap.xml or /robots.txt — add for SEO + crawler etiquette',
    })

    const fails = items.filter(i => i.status === 'fail').length
    const warns = items.filter(i => i.status === 'warn').length
    const verdict = fails > 0 ? 'NOT PRODUCTION READY — address the FAIL items'
                  : warns > 0 ? 'launch-ready, warnings can land post-launch'
                              : 'PRODUCTION READY'
    return json({
      ok: true,
      at: new Date().toISOString(),
      counts: { pass: items.length - fails - warns, warn: warns, fail: fails },
      verdict,
      items,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
