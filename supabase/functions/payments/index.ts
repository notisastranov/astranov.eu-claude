// payments — Stripe Checkout sessions for one-time purchases &
// subscriptions. The first payment provider; Revolut + PayPal will hang
// off the same shape (mode + amount + currency + item).
//
// POST { mode: 'payment' | 'subscription',
//        amount_cents: number,
//        currency: 'eur'|'usd'|...,
//        item_name: string,
//        success_url?: string,
//        cancel_url?: string,
//        metadata?: object,
//        recurring?: 'month'|'year'   // only for mode=subscription
//      }
// → { ok, url }   redirect the client there.
//
// Requires STRIPE_SECRET_KEY in env. Signed-in user identity is captured
// in the metadata so the webhook can credit them.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

async function stripeForm(secret: string, path: string, params: URLSearchParams) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secret,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Stripe ${r.status}`)
  return j
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const STRIPE = Deno.env.get('STRIPE_SECRET_KEY')
    if (!STRIPE) return json({ error: 'STRIPE_SECRET_KEY not configured.' }, 503)

    const body = await req.json().catch(() => ({}))
    const mode = String(body.mode || 'payment')
    const amount_cents = Math.max(50, Math.round(Number(body.amount_cents || 0)))   // €0.50 min
    const currency = String(body.currency || 'eur').toLowerCase()
    const item_name = String(body.item_name || 'AstranoV').slice(0, 120)
    const success_url = String(body.success_url || 'https://astranov.eu/?paid=1').slice(0, 500)
    const cancel_url  = String(body.cancel_url  || 'https://astranov.eu/?paid=0').slice(0, 500)
    const recurring   = body.recurring ? String(body.recurring) : null

    if (!amount_cents || !currency) return json({ error: 'amount_cents + currency required' }, 400)
    if (mode !== 'payment' && mode !== 'subscription') return json({ error: 'mode must be payment or subscription' }, 400)

    // Identify the actor (optional — anonymous buys allowed for vendor-side).
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    let profileId: string | null = null
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token && token !== anonKey) {
      try { const { data: ud } = await sb.auth.getUser(token); if (ud?.user) profileId = ud.user.id } catch (_) {}
    }

    // 1. Inline price object — Stripe Checkout supports price_data directly,
    //    no separate Price/Product creation needed.
    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('success_url', success_url)
    params.set('cancel_url',  cancel_url)
    params.set('line_items[0][quantity]', '1')
    params.set('line_items[0][price_data][currency]', currency)
    params.set('line_items[0][price_data][unit_amount]', String(amount_cents))
    params.set('line_items[0][price_data][product_data][name]', item_name)
    if (mode === 'subscription' && recurring) {
      params.set('line_items[0][price_data][recurring][interval]', recurring)
    }
    // Metadata for the webhook to credit the buyer & the AstranoV 3%
    // royalty bookkeeping.
    if (profileId) params.set('metadata[profile_id]', profileId)
    params.set('metadata[item]', item_name)
    if (body.metadata && typeof body.metadata === 'object') {
      let i = 0
      for (const [k, v] of Object.entries(body.metadata)) {
        if (i++ >= 10) break
        params.set(`metadata[${k}]`, String(v).slice(0, 500))
      }
    }
    // Allow card + most EU rails (SEPA, ideal, sofort).
    params.set('payment_method_types[]', 'card')

    const session = await stripeForm(STRIPE, 'checkout/sessions', params)
    return json({ ok: true, url: session.url, id: session.id })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
