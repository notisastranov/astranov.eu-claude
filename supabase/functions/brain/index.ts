// AstranoV brain — self-improvement & ownership pipeline.
// Owner-only modes:
//   { mode: 'stats'   } → memory + corpus counts
//   { mode: 'distill' } → compress raw creator-dialogue/user-taught memories
//                         into sharp principle-memories (embedded), mark raw consumed
//   { mode: 'export'  } → JSONL training corpus from cic_logs for fine-tuning
//
// Distillation is what makes the brain self-improving: instead of an ever-
// growing transcript, the creator's worldview is repeatedly re-crystallised
// into a compact, high-signal set of principles that always lead recall.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }) }

async function embedText(key: string, text: string): Promise<number[] | null> {
  try {
    const model = 'models/gemini-embedding-001'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, content: { parts: [{ text: text.slice(0, 8000) }] }, outputDimensionality: 768 }) })
    if (!r.ok) return null
    const j = await r.json()
    return Array.isArray(j.embedding?.values) ? j.embedding.values : null
  } catch { return null }
}

async function distillLLM(messages: { role: string; content: string }[]): Promise<string | null> {
  const OR = Deno.env.get('OPENROUTER_API_KEY') || Deno.env.get('OPENROUTER') || Deno.env.get('OPENROUTER.AI')
  const ANTHRO = Deno.env.get('ANTHROPIC_PAID_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
  // Prefer Anthropic for distillation quality; fall back to OpenRouter.
  if (ANTHRO) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': ANTHRO, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-7', max_tokens: 1200,
          system: messages.find(m => m.role === 'system')?.content || '',
          messages: messages.filter(m => m.role !== 'system').map(m => ({ role: 'user', content: m.content })) }),
      })
      if (r.ok) { const j = await r.json(); const t = j.content?.[0]?.text; if (t) return t }
    } catch { /* fall through */ }
  }
  if (OR) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${OR}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://astranov.eu', 'X-Title': 'AstranoV' },
        body: JSON.stringify({ model: Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct', max_tokens: 1200, messages }),
      })
      if (r.ok) { const j = await r.json(); return j.choices?.[0]?.message?.content || null }
    } catch { /* nope */ }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode || 'stats'

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
    if (!ownerId) return json({ error: 'owner only' }, 403)

    const GEMINI = Deno.env.get('GEMINI_API_KEY') || ''

    if (mode === 'stats') {
      const { data: stats } = await sb.rpc('brain_stats')
      const { count: logs } = await sb.from('cic_logs').select('*', { count: 'exact', head: true })
      return json({ memory: stats || [], corpus_rows: logs || 0 })
    }

    if (mode === 'distill') {
      // Pull raw, not-yet-distilled creator + taught memories.
      const { data: raw } = await sb.from('ai_memory')
        .select('id, content, profile_id')
        .in('source', ['creator-dialogue', 'user-taught'])
        .eq('is_private', false).eq('distilled', false)
        .order('created_at', { ascending: true }).limit(60)
      if (!raw || raw.length < 3) return json({ ok: true, distilled: 0, note: 'not enough new material yet' })

      // Existing principles to avoid duplication.
      const { data: existing } = await sb.from('ai_memory')
        .select('content').in('source', ['creator-seed', 'creator-distilled'])
        .eq('profile_id', ownerId).limit(40)

      const sys = `You are the memory consolidator for Astranov, an Internet Operating System built by Notis Astranov.
Read the RAW NOTES (things the creator and users said) and the EXISTING PRINCIPLES.
Distil the raw notes into at most 8 NEW, durable, first-principles statements about Astranov's vision, design law, product, or the creator's worldview.
Rules: each principle one sentence, concrete, non-redundant with existing principles, no fluff, no meta-commentary.
Return ONLY a JSON array of strings. If nothing is worth keeping, return [].`
      const usr = `EXISTING PRINCIPLES:\n${(existing || []).map(e => '- ' + e.content).join('\n') || '(none)'}\n\nRAW NOTES:\n${raw.map(r => '- ' + r.content).join('\n')}`

      const out = await distillLLM([{ role: 'system', content: sys }, { role: 'user', content: usr }])
      let principles: string[] = []
      try {
        const m = (out || '').match(/\[[\s\S]*\]/)
        principles = m ? JSON.parse(m[0]) : []
      } catch { principles = [] }
      principles = principles.filter(p => typeof p === 'string' && p.trim().length > 8).slice(0, 8)

      let inserted = 0
      for (const p of principles) {
        const emb = GEMINI ? await embedText(GEMINI, p) : null
        const { error } = await sb.from('ai_memory').insert({
          profile_id: ownerId, content: p.slice(0, 1000), is_private: false,
          source: 'creator-distilled', importance: 1.6, embedding: emb,
        })
        if (!error) inserted++
      }
      // Mark the raw notes consumed so they don't re-distil.
      await sb.from('ai_memory').update({ distilled: true }).in('id', raw.map(r => r.id))

      return json({ ok: true, consumed: raw.length, distilled: inserted, principles })
    }

    if (mode === 'export') {
      // JSONL training corpus: one chat sample per logged exchange.
      const { data: logs } = await sb.from('cic_logs')
        .select('query, response').not('response', 'is', null)
        .order('created_at', { ascending: false }).limit(2000)
      const lines = (logs || [])
        .filter(l => l.query && l.response)
        .map(l => JSON.stringify({ messages: [
          { role: 'system', content: 'You are Astranov, the AstranoV Collective Artificial Intelligence.' },
          { role: 'user', content: l.query },
          { role: 'assistant', content: l.response },
        ] }))
      return json({ ok: true, count: lines.length, jsonl: lines.join('\n') })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
