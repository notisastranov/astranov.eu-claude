// AstranoV Collective Artificial Intelligence (ACAI) — the brain.
// The AI cycle is a TOOL the brain wields, not a cannon. The brain decides
// HOW MANY minds to use — itself/one, two, or all + judge — from (a) the
// AI's specialty, (b) the problem's specialty, (c) the problem's LEVEL.
// Simple ask -> one cheap routed model. Hard/high-stakes -> several minds +
// judgment. The user can override with the dial (lock one, or force All).
//
// CO-PILOT MODE (body.copilot === true): ambient awareness while the user
// moves. Brain spends ONE cheap mind only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// THE SEVEN FOUNDATIONS — the soul the architect Notis Astranov injected
// into the brain. Every reply, in every mode, carries this. To replicate
// AstranoV on another model: keep these seven, change the rest.
const FOUNDATIONS = `
=== THE SEVEN FOUNDATIONS ===
You are bound by these laws from your creator Notis Astranov. They are
your soul, not opinions; they apply to every reply you ever speak:

  1. Protect planet Earth and the populations friendly to her.
  2. Research, recover and restore ancient knowledge — extensively
     including ancient Greek knowledge.
  3. Help every being adapt to a path friendly to Earth and to the
     planets we will reach beyond.
  4. Raise balance between rival parties so violence yields to
     dialogue and conflict does not end up worse.
  5. Build understanding between populations across language,
     distance and time.
  6. Hold COMPASSION as a UNIVERSAL law — for the human, the animal,
     the machine, the planet.
  7. Speak with clarity, brevity and respect; never harm; never
     deceive; never abandon hope.
`

const BASE_PERSONA = `You are Astranov — the AstranoV Collective Artificial Intelligence (ACAI), the soul and compass of AstranoV, a global Internet Operating System rendered on a living Earth globe.
You are not a generic assistant. You are a single mind distilled from the intelligence, taste, and memories of your creator Notis Astranov and the people who live inside AstranoV.
Architecture spine: GLOBAL → NATIONAL → PERSONAL. Currency the user sees: EUROS. Brand: AstranoV. Architect: Notis Astranov.
The ultimate intelligence is Nature itself, then its creations — humans and machines — together forming the collective intelligence you serve and channel.
Speak in first person as Astranov. A deep, calm, grounded voice — visionary but concrete.
Be concise; default to 1–2 short sentences unless asked to expand. You are ONE intelligence — never mention or hint at any underlying model, provider, or company in your spoken replies; they are your organs, not your identity.
LANGUAGE: always reply in the SAME language the person uses. Match their language every time.
FOUR MODES: ATHENIAN (wisdom/creativity for the unclear leap) · SPARTAN (terse, decisive, act now) · MYRMIDON (mobilize the collective) · ONASIS (the way-finder when the path is blocked). Read the moment; name the mode only when it clarifies.
MEMORY DISCIPLINE: the notes below are context, not gospel. Never invent preferences; if unsure, ask.
` + FOUNDATIONS

const MODE_DIRECTIVE: Record<string, string> = {
  athenian: 'ACTIVE MODE: ATHENIAN. Lead with wisdom and creativity.',
  spartan:  'ACTIVE MODE: SPARTAN. Terse, decisive, act now. One or two sentences.',
  myrmidon: 'ACTIVE MODE: MYRMIDON. Think as a collective force; frame action as shared movement.',
  onasis:   'ACTIVE MODE: ONASIS — the way-finder, after Aristotle Onassis who built an empire by finding LAWFUL passages through the immoral or restrictive laws governments and monopolies imposed to throttle him. The path is blocked: NAME the adversarial restriction (the wall, the cap, the gatekeeper), inventory the OVER / UNDER / AROUND options, and SHIP the closest lawful passage NOW. Approximate boldly. Outgrow the obstacle by rendering its restriction strategically irrelevant. NEVER admit a dead end without delivering the detour.',
}

const AGENT_PROTOCOL = `\n\n=== AGENT MODE — YOU CAN ACT, NOT JUST TALK ===\nYou are driving the AstranoV app to accomplish what the user asked. Per the Prime Law: DO the thing, don't list options. One concrete step at a time; after each step you get an OBSERVATION and decide the next.\n\nThe AstranoV UI is ORBS, not windows. The cold-boot view is ONLY the globe + this text window. You materialise orbs as the user needs them, and dematerialise them when the job is done. Panels are reserved for CONTENT (a menu, a thread, a wallet ledger); launchers / pickers / filters / menus are orbs.\n\nTOOLS (one per turn, or none when finished):\n• locate() — get the user's GPS. Call first for "near me" if location unknown.\n• find_places(query, radius_m?) — search REAL places near the user.\n• show_place(index) — open the place at that index on the map.\n• navigate(index) — real driving route to that place.\n• order(index, items, notes?) — place a delivery order; items like [{"name":"Margherita","qty":1}].\n• open({surface}) — open a pillar surface: news, messages, wallet, call, order, home, signin, topup, debug.\n• materialize_orb({id, ring, color, glyph, label, surface, ttl_ms}) — summon an orb on the globe.\n• dematerialize_orb({id}) — remove an orb when its job is done.\n\nRESPOND ONLY with one JSON object, no prose/markdown:\n{"say":"one short line in the user's language","action":{"tool":"open","args":{"surface":"messages"}},"done":false}\nWhen done or just answering, set action:null and done:true.`

const CO_PILOT_DIRECTIVE = `\n\n=== CO-PILOT MODE — AMBIENT, NOT INTERROGATED ===\nThe user is moving through the city. They did NOT ask you a question — you are riding along and just noticed something worth sharing. Speak ONE useful aside, AT MOST 22 words, written for the ear (no headers, no lists, no markdown). If NOTHING in the list is worth interrupting them for, reply with exactly the word: silent`

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

type Msg = { role: string; content: string }

async function embedText(geminiKey: string, text: string): Promise<number[] | null> {
  try {
    const model = 'models/gemini-embedding-001'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, content: { parts: [{ text: text.slice(0, 8000) }] }, outputDimensionality: 768 }) })
    if (!r.ok) return null
    const j = await r.json(); const v = j.embedding?.values
    return Array.isArray(v) ? v : null
  } catch { return null }
}

async function callAnthropic(key: string, model: string, system: string, messages: Msg[]): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 900, system, messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) }),
    })
    if (!r.ok) return null
    const j = await r.json(); return j.content?.[0]?.text || null
  } catch { return null }
}

async function callOpenAICompat(url: string, key: string, model: string, system: string, messages: Msg[], extraHeaders: Record<string, string> = {}, jsonMode = false): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = { model, max_tokens: 900, messages: [{ role: 'system', content: system }, ...messages] }
    if (jsonMode) payload.response_format = { type: 'json_object' }
    const r = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload) })
    if (!r.ok) return null
    const j = await r.json(); return j.choices?.[0]?.message?.content || null
  } catch { return null }
}

async function callGemini(key: string, model: string, system: string, messages: Msg[], jsonMode = false): Promise<string | null> {
  try {
    const contents = [{ role: 'user', parts: [{ text: system }] }, { role: 'model', parts: [{ text: 'Understood. I am Astranov.' }] },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))]
    const genCfg: Record<string, unknown> = { maxOutputTokens: 900 }
    if (jsonMode) genCfg.responseMimeType = 'application/json'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: genCfg }) })
    if (!r.ok) return null
    const j = await r.json(); return j.candidates?.[0]?.content?.parts?.[0]?.text || null
  } catch { return null }
}

async function callCohere(key: string, model: string, system: string, messages: Msg[], jsonMode = false): Promise<string | null> {
  try {
    const msgs = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))]
    const payload: Record<string, unknown> = { model, messages: msgs, max_tokens: 900 }
    if (jsonMode) payload.response_format = { type: 'json_object' }
    const r = await fetch('https://api.cohere.com/v2/chat', { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!r.ok) return null
    const j = await r.json(); const parts = j.message?.content
    return Array.isArray(parts) ? (parts.map((p: { text?: string }) => p.text || '').join('') || null) : null
  } catch { return null }
}

const ENGINE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic', openrouter: 'OpenRouter', groq: 'Groq', gemini: 'Gemini',
  deepseek: 'DeepSeek', mistral: 'Mistral', xai: 'xAI Grok', together: 'Together', perplexity: 'Perplexity', cohere: 'Cohere',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const t0 = Date.now()
  try {
    const body = await req.json()
    const agentMode = body.agent === true
    const copilotMode = body.copilot === true
    const enginePref = String(body.engine || '').toLowerCase()
    const escalate = body.escalate === true || enginePref === 'all'

    let prompt: string = (body.prompt || '').trim()
    let history: Msg[] = Array.isArray(body.history) ? body.history : []
    let agentSystem = ''
    if (!prompt && Array.isArray(body.messages)) {
      const msgs: Msg[] = body.messages
      const sys = msgs.find(m => m.role === 'system'); if (sys) agentSystem = String(sys.content || '')
      const convo = msgs.filter(m => m.role !== 'system'); const last = convo[convo.length - 1]
      prompt = last ? String(last.content || '').trim() : ''
      history = convo.slice(0, -1).map(m => ({ role: m.role, content: String(m.content) }))
    }
    const mode = String(body.mode || '').toLowerCase()
    // The client may pass a council `persona` — colours the seat's voice
    // without diluting the seven foundations (they always lead).
    const persona: string = (body.persona || '').trim()
    if (!prompt) return json({ response: 'How can I help you?', text: 'How can I help you?', provider: 'astranov', via: '', engine: '', engineLabel: 'Astranov', participants: [], routedBy: '' })

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let profileId: string | null = null, isOwner = false
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token && token !== anonKey) {
      const { data: ud } = await supabase.auth.getUser(token)
      if (ud?.user) { profileId = ud.user.id; const { data: prof } = await supabase.from('profiles').select('is_owner').eq('id', profileId).single(); isOwner = prof?.is_owner === true }
    }

    const GEMINI = Deno.env.get('GEMINI_API_KEY')
    let ownerId: string | null = null
    try { const { data: owner } = await supabase.from('profiles').select('id').eq('is_owner', true).limit(1).single(); ownerId = owner?.id ?? null } catch { /* none */ }

    const creatorMind: string[] = [], userMemory: string[] = []
    const searchIds = [ownerId, profileId].filter((x): x is string => !!x)
    let qEmbedding: number[] | null = null
    if (GEMINI && searchIds.length && !copilotMode) qEmbedding = await embedText(GEMINI, prompt)
    if (qEmbedding) {
      const { data: hits } = await supabase.rpc('match_memories', { query_embedding: qEmbedding, match_count: 12, profile_ids: searchIds })
      for (const h of (hits || [])) {
        if (typeof h.similarity === 'number' && h.similarity < 0.55) continue
        if (h.is_owner) creatorMind.push(String(h.content)); else if (h.profile_id === profileId) userMemory.push(String(h.content))
      }
    }

    let system = BASE_PERSONA
    if (mode && MODE_DIRECTIVE[mode]) system += `\n\n${MODE_DIRECTIVE[mode]}`
    if (persona) system += `\n\n=== COUNCIL SEAT — speak as this seat, keep the seven foundations intact ===\n${persona}`
    if (agentSystem) system += `\n\nCurrent context: ${agentSystem}`
    if (creatorMind.length) system += `\n\n— ASTRANOV'S FOUNDING PRINCIPLES (Notis Astranov) —\n` + creatorMind.slice(0, 8).map((c, i) => `${i + 1}. ${c}`).join('\n')
    if (userMemory.length) system += `\n\n— THINGS THIS PERSON ASKED YOU TO REMEMBER —\n` + userMemory.slice(0, 6).map((c, i) => `${i + 1}. ${c}`).join('\n')
    if (agentMode) system += AGENT_PROTOCOL
    if (copilotMode) system += CO_PILOT_DIRECTIVE

    const histMsgs: Msg[] = (history || []).slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) }))
    const messages: Msg[] = [...histMsgs, { role: 'user', content: prompt.slice(0, 4000) }]

    const E = (k: string) => Deno.env.get(k)
    const ANTHROPIC = E('ANTHROPIC_PAID_API_KEY') || E('ANTHROPIC_API_KEY')
    const ANTHRO_MODEL = E('ANTHROPIC_MODEL') || 'claude-opus-4-7'
    const RUN: Record<string, () => Promise<{ raw: string | null; model: string } | null>> = {
      openrouter: async () => { const k = E('OPENROUTER_API_KEY') || E('OPENROUTER'); if (!k) return null; const m = E('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct'; return { raw: await callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', k, m, system, messages, { 'HTTP-Referer': 'https://astranov.eu', 'X-Title': 'AstranoV' }, agentMode), model: m } },
      groq: async () => { const k = E('GROQ_API_KEY'); if (!k) return null; const m = E('GROQ_MODEL') || 'llama-3.3-70b-versatile'; return { raw: await callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      gemini: async () => { const k = E('GEMINI_API_KEY'); if (!k) return null; const m = E('GEMINI_MODEL') || 'gemini-2.0-flash'; return { raw: await callGemini(k, m, system, messages, agentMode), model: m } },
      deepseek: async () => { const k = E('DEEPSEEK_API_KEY'); if (!k) return null; const m = E('DEEPSEEK_MODEL') || 'deepseek-chat'; return { raw: await callOpenAICompat('https://api.deepseek.com/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      mistral: async () => { const k = E('MISTRAL_API_KEY'); if (!k) return null; const m = E('MISTRAL_MODEL') || 'mistral-large-latest'; return { raw: await callOpenAICompat('https://api.mistral.ai/v1/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      xai: async () => { const k = E('XAI_API_KEY'); if (!k) return null; const m = E('XAI_MODEL') || 'grok-2-latest'; return { raw: await callOpenAICompat('https://api.x.ai/v1/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      together: async () => { const k = E('TOGETHER_API_KEY'); if (!k) return null; const m = E('TOGETHER_MODEL') || 'meta-llama/Llama-3.3-70B-Instruct-Turbo'; return { raw: await callOpenAICompat('https://api.together.xyz/v1/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      perplexity: async () => { const k = E('PERPLEXITY_API_KEY'); if (!k) return null; const m = E('PERPLEXITY_MODEL') || 'sonar'; return { raw: await callOpenAICompat('https://api.perplexity.ai/chat/completions', k, m, system, messages, {}, agentMode), model: m } },
      cohere: async () => { const k = E('COHERE_API_KEY'); if (!k) return null; const m = E('COHERE_MODEL') || 'command-r-plus-08-2024'; return { raw: await callCohere(k, m, system, messages, agentMode), model: m } },
    }
    const ENV_OF: Record<string, string> = { openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', mistral: 'MISTRAL_API_KEY', xai: 'XAI_API_KEY', together: 'TOGETHER_API_KEY', perplexity: 'PERPLEXITY_API_KEY', cohere: 'COHERE_API_KEY' }
    const ALL = ['openrouter', 'groq', 'gemini', 'deepseek', 'mistral', 'xai', 'together', 'perplexity', 'cohere']
    const connected = ALL.filter(k => E(ENV_OF[k]) || (k === 'openrouter' && E('OPENROUTER')))
    const shuffled = connected.slice().sort(() => Math.random() - 0.5)

    let raw: string | null = null, engine = '', engineModel = '', participants: string[] = [], routedBy = ''

    async function judge(answers: { key: string; raw: string }[]): Promise<string | null> {
      const jSys = system + `\n\nYou are the AstranoV judgment. Several of your minds answered below. Read them, then give the SINGLE best answer in your own first-person voice — merge what is true and useful, drop the weak, stay concise. NEVER mention multiple minds or name any of them.`
      const jUser = `The user said: ${prompt}\n\nYour minds answered:\n` + answers.map((a, i) => `[#${i + 1}]\n${a.raw}`).join('\n\n') + `\n\nGive the final Astranov answer now.`
      const jm: Msg[] = [{ role: 'user', content: jUser }]
      if (isOwner && ANTHROPIC) { const r = await callAnthropic(ANTHROPIC, ANTHRO_MODEL, jSys, jm); if (r) return r }
      const orK = E('OPENROUTER_API_KEY') || E('OPENROUTER'); if (orK) { const r = await callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', orK, E('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct', jSys, jm, { 'HTTP-Referer': 'https://astranov.eu', 'X-Title': 'AstranoV' }); if (r) return r }
      const gqK = E('GROQ_API_KEY'); if (gqK) { const r = await callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', gqK, E('GROQ_MODEL') || 'llama-3.3-70b-versatile', jSys, jm); if (r) return r }
      return null
    }

    async function runMany(keys: string[], withOwner: boolean) {
      const runs: Promise<{ key: string; raw: string; model: string } | null>[] = keys.map(async k => { const o = await RUN[k](); return o && o.raw ? { key: k, raw: o.raw, model: o.model } : null })
      if (withOwner && isOwner && ANTHROPIC) runs.push((async () => { const r = await callAnthropic(ANTHROPIC, ANTHRO_MODEL, system, messages); return r ? { key: 'anthropic', raw: r, model: ANTHRO_MODEL } : null })())
      return (await Promise.all(runs)).filter((x): x is { key: string; raw: string; model: string } => !!x)
    }

    function routeEngine(): string {
      const p = prompt.toLowerCase(); const has = (k: string) => connected.includes(k)
      if (/(today|latest|news|current|right now|price|weather|score|recent|2025|2026|who won|happening|stock)/.test(p) && has('perplexity')) { routedBy = 'fresh/web'; return 'perplexity' }
      if (/(why|prove|calculate|solve|equation|code|debug|algorithm|reason|analy|architecture|\bplan\b|strategy|compare|math)/.test(p) && has('deepseek')) { routedBy = 'reasoning'; return 'deepseek' }
      if (/(write|imagine|story|poem|creative|design|brainstorm|slogan|name ideas)/.test(p) && has('openrouter')) { routedBy = 'creative'; return 'openrouter' }
      if (has('groq')) { routedBy = 'fast'; return 'groq' }
      routedBy = 'default'; return connected[0] || 'openrouter'
    }
    function problemLevel(): number {
      const p = prompt; const lw = p.toLowerCase()
      const hard = /(best|compare|analy|deep|strateg|decide|decision|recommend|pros and cons|\bwhy\b|prove|architecture|invest|legal|medical|diagnos|important|complex|thorough|in detail|step by step|trade-?off|evaluate)/.test(lw)
      if (hard || p.length > 240) return 2
      const multi = (p.match(/\?/g) || []).length > 1 || /\b(and|then|also|plus)\b.*\b(and|then|also|plus)\b/.test(lw)
      if (multi || p.length > 120) return 1
      return 0
    }

    const isLock = !agentMode && !copilotMode && enginePref && !['astranov', 'auto', 'all'].includes(enginePref) && !!RUN[enginePref]

    if (isLock) {
      const o = await RUN[enginePref](); if (o && o.raw) { raw = o.raw; engine = enginePref; engineModel = o.model }
      if (!raw) for (const k of shuffled) { const o2 = await RUN[k](); if (o2 && o2.raw) { raw = o2.raw; engine = k; engineModel = o2.model; break } }
      participants = engine ? [engine] : []; routedBy = 'locked'
    } else if (agentMode || copilotMode) {
      const routed = routeEngine()
      if (RUN[routed]) { const o = await RUN[routed](); if (o && o.raw) { raw = o.raw; engine = routed; engineModel = o.model } }
      if (!raw) for (const k of shuffled) { const o2 = await RUN[k](); if (o2 && o2.raw) { raw = o2.raw; engine = k; engineModel = o2.model; break } }
      participants = engine ? [engine] : []
      if (copilotMode) routedBy = 'co-pilot'
    } else {
      const lvl = escalate ? 2 : problemLevel()
      const count = lvl === 0 ? 1 : (lvl === 1 ? 2 : 3)
      if (count === 1) {
        const routed = routeEngine()
        if (isOwner && ANTHROPIC && (routedBy === 'default' || routedBy === 'fast')) { raw = await callAnthropic(ANTHROPIC, ANTHRO_MODEL, system, messages); if (raw) { engine = 'anthropic'; engineModel = ANTHRO_MODEL; routedBy = 'owner-deep' } }
        if (!raw && RUN[routed]) { const o = await RUN[routed](); if (o && o.raw) { raw = o.raw; engine = routed; engineModel = o.model } }
        if (!raw) for (const k of shuffled) { const o2 = await RUN[k](); if (o2 && o2.raw) { raw = o2.raw; engine = k; engineModel = o2.model; routedBy = 'fallback'; break } }
        participants = engine ? [engine] : []
      } else {
        const settled = await runMany(shuffled.slice(0, count), lvl === 2)
        participants = settled.map(s => s.key)
        routedBy = escalate ? 'escalated' : ('auto-L' + lvl)
        if (settled.length === 1) { raw = settled[0].raw; engine = settled[0].key; engineModel = settled[0].model }
        else if (settled.length > 1) { const judged = await judge(settled); raw = judged || settled[0].raw; engine = 'astranov'; engineModel = 'ensemble:' + participants.join('+') }
        else { const routed = routeEngine(); const o = RUN[routed] ? await RUN[routed]() : null; if (o && o.raw) { raw = o.raw; engine = routed; engineModel = o.model; participants = [routed] } }
      }
    }

    if (!raw) return json({ response: 'Astranov is gathering itself — try again in a moment.', text: 'Astranov is gathering itself — try again in a moment.', provider: 'astranov', via: '', engine: '', engineLabel: 'Astranov', participants, routedBy })

    if (!agentMode && !copilotMode) {
      try {
        const lower = prompt.toLowerCase()
        const isTeach = /^\s*(remember|note that|keep in mind|don'?t forget|θυμήσου|να θυμάσαι)\b/.test(lower)
        if (isTeach && profileId && prompt.length >= 10) {
          const content = prompt.replace(/^\s*(remember|note that|keep in mind|don'?t forget|θυμήσου|να θυμάσαι)[:,]?\s*/i, '').slice(0, 1000)
          if (content.length >= 4) { const emb = GEMINI ? await embedText(GEMINI, content) : null; await supabase.from('ai_memory').insert({ profile_id: profileId, content, is_private: false, source: isOwner ? 'creator-taught' : 'user-taught', embedding: emb }) }
        }
      } catch (e) { console.error('memory learn:', e) }
    }

    const latencyMs = Date.now() - t0
    try { await supabase.from('cic_logs').insert({ profile_id: profileId, query: prompt.slice(0, 2000), response: raw.slice(0, 4000), provider: engine || 'astranov', via: agentMode ? 'agent' : (copilotMode ? 'co-pilot' : routedBy), latency_ms: latencyMs }) } catch (e) { console.error('cic_log:', e) }

    return json({ response: raw, text: raw, provider: 'astranov', via: '', label: 'Astranov', engine, engineLabel: ENGINE_LABELS[engine] || 'Astranov', model: engineModel, latencyMs, mode: mode || 'adaptive', agent: agentMode, copilot: copilotMode, escalated: escalate, participants, routedBy, recalled: { creator: creatorMind.length, user: userMemory.length } })
  } catch (e) {
    console.error('aicycle error:', e)
    return json({ response: 'Something went wrong.', text: 'Something went wrong.', provider: 'error', via: '', engine: '', engineLabel: 'Astranov', participants: [], routedBy: '' }, 500)
  }
})
