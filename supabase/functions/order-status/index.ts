// order-status: vendor or customer flips order status; broadcasts via Realtime.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

const ALLOWED = new Set(['pending', 'accepted', 'preparing', 'in_transit', 'delivered', 'cancelled'])

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json().catch(() => ({}))
    const { order_id, status, eta_minutes } = body
    if (!order_id || !ALLOWED.has(status)) {
      return new Response(JSON.stringify({ error: 'order_id + valid status required' }), { status: 400, headers: cors })
    }

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    const { data: order, error } = await sb.from('orders').update(patch).eq('id', order_id).select().single()
    if (error) throw error

    // Broadcast to vendor channel AND to per-order channel for the customer
    try {
      const payload = { order_id, short_id: order.short_id, status, eta_minutes }
      await sb.channel(`order-${order_id}`).send({ type: 'broadcast', event: 'status', payload })
      if (order.vendor_id) {
        await sb.channel(`vendor-orders-${order.vendor_id}`).send({ type: 'broadcast', event: 'status', payload })
      }
    } catch (_) { /* non-fatal */ }

    return new Response(JSON.stringify({ ok: true, order }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors })
  }
})
