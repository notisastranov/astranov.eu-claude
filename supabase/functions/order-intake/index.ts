// order-intake: validate, debit the customer's euro wallet, persist the order,
// broadcast new_order to the vendor's Realtime channel, push-notify the
// vendor owner. Users pay in EUR (eur_balance); AVC is owner-only and
// never touched here.
//
// LAW (§11): royalty is 3% — the same number the client shows. The
// delivery fee is validated against a server-side recompute of the
// €1/km base; the client's multipliers (night / long-haul / surge) are
// accepted only within the lawful ceiling. No fabricated driver
// personas — a driver exists only when a real runner accepts.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

// §11: 3% royalty — mirror of the client's PRICING.platform_fee_pct.
const PLATFORM_FEE_PCT = 0.03
// €1/km floor, €3 minimum — mirror of client PRICING.
const BASE_PER_KM = 1.0
const MIN_FEE = 3.0
// Ceiling = night 1.30 × long-haul 1.15 × surge 2.50 ≈ 3.74
const FEE_CEILING_MULT = 3.75

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, d2r = Math.PI / 180
  const dLat = (lat2 - lat1) * d2r, dLng = (lng2 - lng1) * d2r
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*d2r) * Math.cos(lat2*d2r) * Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Optionally identify customer from bearer token
    let customerId: string | null = null
    const auth = req.headers.get('authorization') ?? ''
    if (auth.startsWith('Bearer ')) {
      const anonSb = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { authorization: auth } }, auth: { persistSession: false } }
      )
      const { data: { user } } = await anonSb.auth.getUser()
      customerId = user?.id ?? null
    }

    const body = await req.json().catch(() => ({}))
    const { vendor_id, vendor, items, calc, delivery_lat, delivery_lng, delivery_address, notes } = body

    if (!vendor_id || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'vendor_id and items required' }), { status: 400, headers: cors })
    }

    // Authoritative total — recompute server-side from items, never trust client calc.
    const subtotal = items.reduce((s: number, it: Record<string, unknown>) =>
      s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0)

    // Delivery fee: recompute the €1/km base when we have both coords,
    // then accept the client's fee only inside [base, base × ceiling].
    // Outside the band → clamp to the recomputed base. No coords →
    // accept a sane client fee, else the €3 minimum.
    const vLat = Number(vendor?.lat), vLng = Number(vendor?.lng)
    const dLat = Number(delivery_lat), dLng = Number(delivery_lng)
    const clientFee = Number(calc?.delivery_fee)
    let delivery_fee: number
    if (Number.isFinite(vLat) && Number.isFinite(vLng) && Number.isFinite(dLat) && Number.isFinite(dLng)) {
      const km = haversineKm(vLat, vLng, dLat, dLng)
      const base = Math.max(MIN_FEE, km * BASE_PER_KM)
      delivery_fee = (Number.isFinite(clientFee) && clientFee >= base && clientFee <= base * FEE_CEILING_MULT)
        ? clientFee : Math.round(base * 100) / 100
    } else {
      delivery_fee = (Number.isFinite(clientFee) && clientFee >= MIN_FEE && clientFee <= 100)
        ? clientFee : MIN_FEE
    }

    // §11: 3% royalty, same rounding the client shows (min €1).
    const platform_fee = subtotal ? Math.max(1, Math.round(subtotal * PLATFORM_FEE_PCT)) : 0
    const total = Math.round((subtotal + delivery_fee + platform_fee) * 100) / 100
    const settledCalc = { subtotal, delivery_fee, platform_fee, total, currency: 'EUR' }

    // Debit the customer's euro wallet up-front. No money, no order.
    if (customerId && total > 0) {
      const { error: debitErr } = await sb.rpc('order_debit_eur', { p_profile: customerId, p_amount: total })
      if (debitErr) {
        const insufficient = String(debitErr.message || debitErr).includes('insufficient_funds')
        return new Response(
          JSON.stringify({ ok: false, error: insufficient ? 'insufficient_funds' : String(debitErr.message || debitErr) }),
          { status: insufficient ? 402 : 500, headers: cors }
        )
      }
    }

    // Upsert vendor row from OSM payload so orders.vendor_id always resolves
    if (vendor && (vendor.name || vendor.lat)) {
      try {
        await sb.from('vendors').upsert({
          id:       vendor_id,
          osm_id:   vendor.osm_id ?? (vendor_id.startsWith('osm:') ? vendor_id.slice(4) : null),
          name:     vendor.name || 'Unknown',
          emoji:    vendor.emoji || '🎪',
          category: vendor.category || 'shop',
          lat:      Number(vendor.lat) || 0,
          lng:      Number(vendor.lng) || 0,
          address:  vendor.address ?? {},
          tags:     vendor.tags ?? {},
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      } catch (_) { /* non-fatal */ }
    }

    // No fabricated driver persona (§11). driver_name stays NULL until a
    // real runner calls accept_delivery on the spawned deliveries row.
    const { data: order, error } = await sb
      .from('orders')
      .insert({
        vendor_id,
        customer_id: customerId,
        items,
        calc: settledCalc,
        status: 'pending',
        driver_name: null,
        driver_emoji: null,
        delivery_lat: delivery_lat ?? null,
        delivery_lng: delivery_lng ?? null,
        delivery_address: delivery_address ?? null,
        notes: notes ?? null,
      })
      .select()
      .single()

    if (error) {
      // Refund the debit so the customer never loses money to a failed insert.
      if (customerId && total > 0) {
        try { await sb.rpc('order_refund_eur', { p_profile: customerId, p_amount: total }) } catch (_) {}
      }
      throw error
    }

    // Notify vendor over Realtime broadcast channel
    try {
      const ch = sb.channel(`vendor-orders-${vendor_id}`)
      await ch.send({
        type: 'broadcast',
        event: 'new_order',
        payload: {
          order_id: order.id,
          short_id: order.short_id,
          items,
          calc: settledCalc,
        }
      })
      await sb.removeChannel(ch)
    } catch (_) { /* non-fatal */ }

    // Web-push the vendor OWNER so the order desk works even with the
    // app closed. Best-effort; a push failure never fails the order.
    try {
      const { data: vrow } = await sb.from('vendors').select('owner_id, name').eq('id', vendor_id).single()
      if (vrow?.owner_id) {
        const itemLine = items.slice(0, 3).map((it: Record<string, unknown>) => `${it.qty}× ${it.name}`).join(' · ')
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push-notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            recipient_id: vrow.owner_id,
            payload: {
              type:  'order',
              title: `◈ New order — ${vrow.name || 'your business'}`,
              body:  `${itemLine}${items.length > 3 ? ' …' : ''} · €${total.toFixed(2)}`,
              tag:   'order-' + order.id,
            },
          }),
        })
      }
    } catch (_) { /* non-fatal */ }

    return new Response(JSON.stringify({ ok: true, order }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors })
  }
})
