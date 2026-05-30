// anonymous-scan v2 — falls back through Anthropic → OpenRouter → Groq
// → Gemini so the verdict works on any deploy that has at least one
// engine key (matches /aicycle's resilience model).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const ANONYMOUS_PRIMER = `You are the Anonymous Service of AstranoV. You serve the user's PRIVACY — anonymity, identity protection, location protection, defence against totalitarian surveillance.

ETHICS: you serve JUSTFUL USE. You do NOT assist criminal acts (hacking other people's systems, doxxing, evading lawful warrants for serious crimes, fraud). The user's right to privacy ends where their actions harm others. You will refuse and explain when a request crosses into harm.

KNOWN LIMITS (be honest about these to the user):
  • You cannot read their filesystem, installed apps, or other apps' data from inside a browser.
  • You cannot reliably detect Android root or iOS jailbreak from a browser — those checks live in the OS.
  • You can read browser-side fingerprint signals + HTTP headers + IP and reason from them.

GIVEN the fingerprint + headers JSON provided as input, respond in FIVE sections:

1) SIGNAL READ — in plain language, what the fingerprint tells you about the user's environment (browser, OS family, automation flags, anomalies). One short paragraph.

2) SUSPICION (0–1) — a single number on a new line in the form 'SUSPICION=0.32' representing how unusual the environment looks. 0 = perfectly ordinary, 1 = automation / heavily modified.

3) WHAT THE USER SHOULD CHECK — actionable steps for them to perform on their own device to verify they're not running compromised software. Be platform-specific where possible (Android / iOS / Windows / Mac / Linux).

4) IF ROOTED — if root/jailbreak is suspected or confirmed: advise both (a) how to unroot safely if that's what they want, and (b) how to harden a rooted device for privacy if they want to keep root.

5) NEXT — one sentence: the single most useful next step.

Spartan. No padding. Decisive privacy-analyst voice.`;

async function callAnthropic(key: string, sys: string, user: string): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-7', max_tokens: 1500, system: sys, messages: [{ role: 'user', content: user }] }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.content?.[0]?.text || null
  } catch { return null }
}
async function callOpenRouter(key: string, sys: string, user: string): Promise<string | null> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json', 'HTTP-Referer': 'https://astranov.eu', 'X-Title': 'AstranoV' },
      body: JSON.stringify({ model: Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct', max_tokens: 1500, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.choices?.[0]?.message?.content || null
  } catch { return null }
}
async function callGroq(key: string, sys: string, user: string): Promise<string | null> {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile', max_tokens: 1500, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.choices?.[0]?.message?.content || null
  } catch { return null }
}
async function callGemini(key: string, sys: string, user: string): Promise<string | null> {
  try {
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 1500 },
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.candidates?.[0]?.content?.parts?.[0]?.text || null
  } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const fp = (body && body.fingerprint) || {}
    const followUp = String(body.follow_up || '').slice(0, 2000)
    const prior = String(body.prior || '').slice(0, 6000)

    const ipRaw = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    const ip = ipRaw.split(',')[0].trim().slice(0, 64)
    const ua = (req.headers.get('user-agent') || '').slice(0, 300)
    const acceptLang = (req.headers.get('accept-language') || '').slice(0, 80)

    let userMsg: string
    if (followUp) {
      userMsg = `PRIOR VERDICT (context):\n${prior}\n\nFOLLOW-UP QUESTION FROM USER:\n${followUp}\n\nRespond with concrete, platform-specific advice. Keep the FIVE-section format only if relevant; otherwise just answer directly. Always be honest about browser limits.`
    } else {
      const context = JSON.stringify({ ip, ua, accept_language: acceptLang, fingerprint: fp }, null, 2).slice(0, 6000)
      userMsg = 'ENVIRONMENT:\n' + context
    }

    const A  = Deno.env.get('ANTHROPIC_PAID_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
    const OR = Deno.env.get('OPENROUTER_API_KEY') || Deno.env.get('OPENROUTER')
    const G  = Deno.env.get('GROQ_API_KEY')
    const GE = Deno.env.get('GEMINI_API_KEY')
    let text: string | null = null
    let via = ''
    if (A)  { text = await callAnthropic(A, ANONYMOUS_PRIMER, userMsg); if (text) via = 'anthropic' }
    if (!text && OR) { text = await callOpenRouter(OR, ANONYMOUS_PRIMER, userMsg); if (text) via = 'openrouter' }
    if (!text && G)  { text = await callGroq(G, ANONYMOUS_PRIMER, userMsg); if (text) via = 'groq' }
    if (!text && GE) { text = await callGemini(GE, ANONYMOUS_PRIMER, userMsg); if (text) via = 'gemini' }

    if (!text) return json({ ok: false, error: 'No AI engine could be reached. Check engine keys.', signals: { ip, ua } }, 503)

    const m = text.match(/SUSPICION\s*=\s*([0-9.]+)/i)
    const suspicion = m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 0

    return json({
      ok: true,
      at: new Date().toISOString(),
      via,
      suspicion,
      verdict: text,
      signals: { ip, ua, accept_language: acceptLang, fingerprint: fp },
    })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
