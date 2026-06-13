// vendor-menu: Astranov composes a plausible menu for an OSM vendor that has
// no published menu. Returns dishes + AVC prices the user can tap to add to cart.
// Cached per vendor in the vendors.items column so we don't re-compose every time.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }) }

async function compose(vendor: Record<string, unknown>): Promise<{ name: string; price: number; desc: string }[]> {
  const OR = Deno.env.get('OPENROUTER_API_KEY') || Deno.env.get('OPENROUTER') || Deno.env.get('OPENROUTER.AI')
  const ANTHRO = Deno.env.get('ANTHROPIC_PAID_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
  const name = String(vendor.name || 'this place')
  const cat = String(vendor.category || 'shop')
  const cuisine = String((vendor.tags as Record<string, unknown>)?.cuisine || '')
  const sys = `You compose a realistic menu for a real-world venue so a customer can order on AstranoV. Prices are in AVC where 1 AVC = 1 EUR — use sensible local prices.
Return STRICT JSON only: {"items":[{"name":"...","price":<number>,"desc":"short"}]}. 6-10 items. If it is not a food/drink place (e.g. a pharmacy, shop), list its typical orderable products instead. No prose outside the JSON.`
  const usr = `Venue: "${name}". Category: ${cat}.${cuisine ? ' Cuisine: ' + cuisine + '.' : ''} Compose its menu.`
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: usr }]

  let raw: string | null = null
  if (OR) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${OR}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://astranov.eu', 'X-Title': 'AstranoV' },
        body: JSON.stringify({ model: Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct', max_tokens: 700, messages }),
      })
      if (r.ok) { const j = await r.json(); raw = j.choices?.[0]?.message?.content || null }
    } catch { /* fall through */ }
  }
  if (!raw && ANTHRO) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': ANTHRO, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-7', max_tokens: 700, system: sys, messages: [{ role: 'user', content: usr }] }),
      })
      if (r.ok) { const j = await r.json(); raw = j.content?.[0]?.text || null }
    } catch { /* nope */ }
  }
  let items: { name: string; price: number; desc: string }[] = []
  try {
    const m = (raw || '').match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : {}
    items = (parsed.items || []).map((x: Record<string, unknown>) => ({
      name: String(x.name || '').slice(0, 80),
      price: Math.max(1, Math.round(Number(x.price) || 5)),
      desc: String(x.desc || '').slice(0, 120),
    })).filter((x: { name: string }) => x.name).slice(0, 10)
  } catch { items = [] }
  return items
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const { vendor_id, vendor } = body
    if (!vendor && !vendor_id) return json({ error: 'vendor required' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Serve cached menu if we already composed one for this vendor.
    if (vendor_id) {
      const { data: row } = await sb.from('vendors').select('items').eq('id', vendor_id).single()
      if (row?.items && Array.isArray(row.items) && row.items.length) {
        return json({ ok: true, items: row.items, cached: true })
      }
    }

    const items = await compose(vendor || {})
    if (!items.length) return json({ ok: true, items: [] })

    // Cache on the vendor row (best-effort; upsert if vendor exists or id given).
    if (vendor_id) {
      try { await sb.from('vendors').update({ items }).eq('id', vendor_id) } catch (_) {}
    }
    return json({ ok: true, items, cached: false })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
