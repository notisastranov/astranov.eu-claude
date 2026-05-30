// stripe-webhook — handles Stripe Checkout completion. See deploy v1.
// Verifies the Stripe-Signature header (HMAC-SHA256 on `${ts}.${body}`),
// writes payments + royalties (3% per Orbital License) and credits AVC.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature' }
function json(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
async function verifyStripe(rawBody: string, sig: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')))
    const ts = parts.t, v1 = parts.v1
    if (!ts || !v1) return false
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${rawBody}`))
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    if (Math.abs(Date.now()/1000 - parseInt(ts, 10)) > 300) return false
    return hex === v1
  } catch { return false }
}
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    if (!secret) return json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, 503)
    const sig = req.headers.get('stripe-signature') || ''
    const raw = await req.text()
    if (!await verifyStripe(raw, sig, secret)) return json({ error: 'invalid signature' }, 400)
    const evt = JSON.parse(raw)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object
      const provider_ref = String(s.id)
      const amount_cents = Number(s.amount_total) || 0
      const currency = String(s.currency || 'eur').toLowerCase()
      const profile_id = s.metadata?.profile_id || null
      const item = s.metadata?.item || 'AVC'
      const royalty = Math.round(amount_cents * 0.03)
      const { data: pay, error } = await sb.from('payments').upsert({
        provider: 'stripe', provider_ref, status: 'paid', profile_id, amount_cents, currency, item,
        metadata: s.metadata || {}, paid_at: new Date().toISOString(), raw_event: evt,
      }, { onConflict: 'provider,provider_ref' }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      await sb.from('royalties').insert({ payment_id: pay!.id, amount_cents, royalty_cents: royalty, currency, source: 'stripe.checkout.session.completed' })
      if (profile_id) await sb.rpc('credit_avc', { p_profile_id: profile_id, p_avc: amount_cents / 100 }).catch(() => {})
      return json({ ok: true, payment_id: pay!.id, royalty_cents: royalty })
    }
    if (evt.type === 'payment_intent.payment_failed' || evt.type === 'checkout.session.expired') {
      const s = evt.data.object
      await sb.from('payments').upsert({
        provider: 'stripe', provider_ref: String(s.id), status: 'failed',
        amount_cents: Number(s.amount_total || 0), currency: String(s.currency || 'eur'), raw_event: evt,
      }, { onConflict: 'provider,provider_ref' })
    }
    return json({ ok: true, ignored: evt.type })
  } catch (e) { return json({ error: String(e) }, 500) }
})
