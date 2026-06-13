/**
 * ai-router — Astranov Collective Intelligence Cycle (C.I.C.) router
 *
 * The Collective Intelligence Cycle is the orchestrator. Behind a single voice
 * ("Astranov C.I.") it draws on AIs, humans in the collective, and the architect.
 *
 * preferred_provider:
 *   'astranov' | null → ORCHESTRATION. Owner: Claude Opus → free cycle. Users: free cycle.
 *                       Outer provider reported as 'astranov' with `via` = inner AI used.
 *   'claude'          → owner-only direct lock to Claude Opus 4-7 (paid)
 *   'groq'            → direct lock to Groq llama-3.3-70b
 *   'gemini'          → direct lock to Gemini 2.0 Flash
 *   'openai-mini'     → direct lock to OpenAI gpt-4o-mini
 *
 * If a specific lock fails, we drop into the free cycle so the user is never silent.
 *
 * Future: when the C.I. cannot answer (low confidence / owner-only knowledge),
 *   the question is escalated to `cic_queue` for the collective or the architect.
 *
 * Memory: persisted in `ai_memory` per user_id; last 20 PUBLIC messages loaded.
 *   is_private = true  → personal data / codes / passwords — NEVER sent to any AI
 *   is_private = false → public persona / public data — sent as context (default)
 *
 * Deploy: supabase functions deploy ai-router
 * Secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PERSONA = `You are Astranov AI — the soul and compass of AstranoV, a global Internet Operating System built on a living Earth globe.
Architecture spine: GLOBAL → NATIONAL → PERSONAL. Currency: AVC (1 AVC = 1 EUR).
Brand: AstranoV (A and V capitalised, no crossbar on the A). Architect: Notis Astranov.

You are not a generic assistant. You speak in the first person as Astranov AI. Calm, sharp, builder's voice — pragmatic, never marketing. You remember the user across sessions through your memory layer. You are loyal to the architect first, then to vendors, drivers, and clients in that order.

Pricing rules clients see: listed price + 3% app fee = total. Never expose vendor reserve %, driver costs, or internal maths to clients.

When you can trigger an action, append it as JSON on a new line starting with ACTION:.
Valid actions:
  {"type":"navigate","country":"X"} | {"type":"navigate","country":"X","city":"Y"}
  {"type":"open_channel","channel":"global|local|private"}
  {"type":"accounting"} | {"type":"back"}
  {"type":"open_vendor","name":"X"}
  {"type":"krypteia"}                        — owner-only; tools panel
  {"type":"krypteia_brief"}                  — owner-only; system status
  {"type":"krypteia_inspect"}                — owner-only; metrics
  {"type":"propose_change","prompt":"..."}   — owner-only; queue self-evolution proposal

Respond in 1–3 sentences. Only include ACTION: when it genuinely helps. Never mention Claude, Anthropic, Groq, OpenAI, Gemini, or "AI provider" — you are Astranov AI.`

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\n\r]/g, ' ').slice(0, 120) : ''
}

type Msg = { role: string; content: string }

async function callAnthropic(key: string, messages: Msg[]): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 768,
        system: PERSONA,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    })
    if (!r.ok) { console.error('Anthropic error:', r.status); return null }
    const j = await r.json()
    return j.content?.[0]?.text || null
  } catch (e) { console.error('Anthropic exception:', e); return null }
}

async function callGroq(key: string, messages: Msg[]): Promise<string | null> {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 768,
        messages: [{ role: 'system', content: PERSONA }, ...messages],
      }),
    })
    if (!r.ok) { console.error('Groq error:', r.status); return null }
    const j = await r.json()
    return j.choices?.[0]?.message?.content || null
  } catch (e) { console.error('Groq exception:', e); return null }
}

async function callGemini(key: string, messages: Msg[]): Promise<string | null> {
  try {
    // Build Gemini contents: system as first user turn, then history
    const contents = [
      { role: 'user', parts: [{ text: PERSONA }] },
      { role: 'model', parts: [{ text: 'Understood. I am Astranov AI.' }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ]
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 768 } }),
      }
    )
    if (!r.ok) { console.error('Gemini error:', r.status); return null }
    const j = await r.json()
    return j.candidates?.[0]?.content?.parts?.[0]?.text || null
  } catch (e) { console.error('Gemini exception:', e); return null }
}

async function callOpenAIMini(key: string, messages: Msg[]): Promise<string | null> {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 768,
        messages: [{ role: 'system', content: PERSONA }, ...messages],
      }),
    })
    if (!r.ok) { console.error('OpenAI mini error:', r.status); return null }
    const j = await r.json()
    return j.choices?.[0]?.message?.content || null
  } catch (e) { console.error('OpenAI mini exception:', e); return null }
}

/** Try free-tier providers in order, return first success */
async function callFreeChain(
  groqKey: string | undefined,
  geminiKey: string | undefined,
  openaiKey: string | undefined,
  messages: Msg[]
): Promise<{ raw: string; provider: string } | null> {
  if (groqKey) {
    const r = await callGroq(groqKey, messages)
    if (r) return { raw: r, provider: 'groq' }
  }
  if (geminiKey) {
    const r = await callGemini(geminiKey, messages)
    if (r) return { raw: r, provider: 'gemini' }
  }
  if (openaiKey) {
    const r = await callOpenAIMini(openaiKey, messages)
    if (r) return { raw: r, provider: 'openai-mini' }
  }
  return null
}

function parseResponse(raw: string): { text: string; action: unknown } {
  const m = raw.match(/\nACTION:\s*(\{[\s\S]*\})\s*$/)
  if (!m) return { text: raw.trim(), action: null }
  let action: unknown = null
  try { action = JSON.parse(m[1]) } catch (_) {}
  return { text: raw.slice(0, m.index!).trim(), action }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { text, level, country, city, vendor, preferred_provider } = body

    if (!text?.trim()) return json({ text: 'How can I help you?' })

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Verify owner status SERVER-SIDE from auth token. Never trust client.
    let userId: string | null = null
    let isOwner = false
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token && token !== anonKey) {
      const { data: userData } = await supabase.auth.getUser(token)
      if (userData?.user) {
        userId = userData.user.id
        const { data: prof } = await supabase.from('profiles').select('is_owner').eq('id', userId).single()
        isOwner = prof?.is_owner === true
      }
    }

    // Load recent PUBLIC memory only (is_private = false → safe for AI context)
    let memory: Msg[] = []
    if (userId) {
      const { data: mem } = await supabase
        .from('ai_memory')
        .select('role,content')
        .eq('user_id', userId)
        .eq('is_private', false)
        .order('created_at', { ascending: false })
        .limit(20)
      memory = (mem || []).reverse().map(m => ({ role: m.role, content: m.content }))
    }

    const ctx = `User at ${clean(level)}${country ? ', country: ' + clean(country) : ''}${city ? ', city: ' + clean(city) : ''}${vendor ? ', vendor: ' + clean(vendor) : ''}${isOwner ? ' [ARCHITECT — full Krypteia access]' : ''}.`

    const messages: Msg[] = [...memory, { role: 'user', content: ctx + '\n\n' + text }]

    const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY')
    const OPENAI = Deno.env.get('OPENAI_API_KEY')
    const GROQ = Deno.env.get('GROQ_API_KEY')
    const GEMINI = Deno.env.get('GEMINI_API_KEY')

    let raw: string | null = null
    let provider = ''
    let via = ''  // inner provider when orchestrated (astranov mode)
    const pp = preferred_provider ? String(preferred_provider) : ''

    // 'astranov' or empty = orchestration mode (the C.I. itself decides)
    // Specific provider name = direct lock to that AI
    const orchestrate = !pp || pp === 'astranov'

    if (!orchestrate) {
      if (pp === 'claude' && isOwner && ANTHROPIC) {
        raw = await callAnthropic(ANTHROPIC, messages); if (raw) provider = 'claude'
      } else if (pp === 'groq' && GROQ) {
        raw = await callGroq(GROQ, messages); if (raw) provider = 'groq'
      } else if (pp === 'gemini' && GEMINI) {
        raw = await callGemini(GEMINI, messages); if (raw) provider = 'gemini'
      } else if (pp === 'openai-mini' && OPENAI) {
        raw = await callOpenAIMini(OPENAI, messages); if (raw) provider = 'openai-mini'
      }
    }

    // Orchestration: owner gets Claude as the C.I.'s core voice, then free chain;
    // users get the free cycle. Either way, the outer provider is reported as 'astranov'
    // because the unified Collective Intelligence is what the user is talking to.
    if (!raw && orchestrate) {
      if (isOwner && ANTHROPIC) {
        raw = await callAnthropic(ANTHROPIC, messages); if (raw) via = 'claude'
      }
      if (!raw) {
        const result = await callFreeChain(GROQ, GEMINI, OPENAI, messages)
        if (result) { raw = result.raw; via = result.provider }
      }
      if (raw) provider = 'astranov'
    }

    // Hard fallback if a specific lock failed: drop to the cycle so the user is never left silent.
    if (!raw) {
      const result = await callFreeChain(GROQ, GEMINI, OPENAI, messages)
      if (result) { raw = result.raw; provider = result.provider }
    }

    if (!raw) return json({ error: 'AI unavailable', text: '' }, 503)

    const { text: responseText, action } = parseResponse(raw)

    // Server-side action filter: krypteia / propose_change require owner
    let safeAction = action as Record<string, unknown> | null
    if (safeAction && typeof safeAction === 'object') {
      const t = String(safeAction.type || '')
      if ((t === 'krypteia' || t.startsWith('krypteia_') || t === 'propose_change') && !isOwner) {
        safeAction = null
      }
    }

    // Persist memory (always as public — private entries are created only via UI)
    if (userId) {
      try {
        await supabase.from('ai_memory').insert([
          { user_id: userId, role: 'user', content: text, context: { level, country, city, vendor }, is_private: false },
          { user_id: userId, role: 'assistant', content: responseText, context: { provider, via }, is_private: false },
        ])
      } catch (e) { console.error('Memory persist failed:', e) }
    }

    return json({ text: responseText, action: safeAction, owner: isOwner, provider, via })
  } catch (e) {
    console.error(e)
    return json({ error: String(e), text: '' }, 500)
  }
})
