// order-intake: validate, persist order, broadcast new_order to vendor's Realtime channel

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

const DRIVERS = [
  { name: 'Stavros', emoji: '🚴' },
  { name: 'Maria',   emoji: '🛵' },
  { name: 'Petros',  emoji: '🚗' },
  { name: 'Elena',   emoji: '🚲' },
  { name: 'Nikos',   emoji: '🏍️' },
]

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

    const driver = DRIVERS[Math.floor(Math.random() * DRIVERS.length)]

    const { data: order, error } = await sb
      .from('orders')
      .insert({
        vendor_id,
        customer_id: customerId,
        items,
        calc: calc ?? {},
        status: 'pending',
        driver_name: driver.name,
        driver_emoji: driver.emoji,
        delivery_lat: delivery_lat ?? null,
        delivery_lng: delivery_lng ?? null,
        delivery_address: delivery_address ?? null,
        notes: notes ?? null,
      })
      .select()
      .single()

    if (error) throw error

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
          calc,
          driver,
        }
      })
      await sb.removeChannel(ch)
    } catch (_) { /* non-fatal */ }

    return new Response(JSON.stringify({ ok: true, order }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors })
  }
})
