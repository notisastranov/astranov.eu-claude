// push-notify — sends Web Push notifications to registered subscribers.
// Called internally from the app after events (message, call invite, delivery).
// Uses manual VAPID + RFC 8291 AES-128-GCM encryption (no external deps).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// VAPID identity — move to env vars in production
const VAPID_PUBLIC_KEY  = 'BDO_nZ43i2Qcb5Ql-p5zh2gqlo4cDQCIdcFbN5KQ1y1rz6eshbdhIqXFH7kZ7pyMK7i7X5D7yeEOQeQSplAkzyU'
const VAPID_PRIVATE_PKCS8_B64U = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzNE6kZs7TgD73Q2k0qlDzamYh3vwp7Xt8fwL0rFIuDChRANCAAQzv52eN4tkHG-UJfqec4doKpaOHA0AiHXBWzeSkNcta8-nrIW3YSKlxR-5Ge6cjCu4u1-Q-8nhDkHkEqZQJM8l'
const VAPID_SUBJECT     = 'mailto:push@astranov.eu'

// ── Helpers ──────────────────────────────────────────────────────────────────
const b64u_enc = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

const b64u_dec = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0))

const concat = (...arrays: Uint8Array[]) => {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ── VAPID JWT ─────────────────────────────────────────────────────────────────
async function vapidToken(endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin
  const exp      = Math.floor(Date.now() / 1000) + 43200
  const enc = new TextEncoder()

  const hdr = b64u_enc(enc.encode(JSON.stringify({ typ:'JWT', alg:'ES256' })))
  const pay = b64u_enc(enc.encode(JSON.stringify({ aud: audience, exp, sub: VAPID_SUBJECT })))
  const msg = `${hdr}.${pay}`

  const pkcs8  = b64u_dec(VAPID_PRIVATE_PKCS8_B64U)
  const privKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, privKey, enc.encode(msg))
  return `${msg}.${b64u_enc(sig)}`
}

// ── RFC 8291 Payload Encryption ────────────────────────────────────────────
async function encrypt(
  plaintext: Uint8Array,
  authSecretB64u: string,
  receiverPubKeyB64u: string,
): Promise<Uint8Array> {
  const authSecret    = b64u_dec(authSecretB64u)
  const receiverPubRaw = b64u_dec(receiverPubKeyB64u)

  // Ephemeral sender ECDH key pair
  const senderKP = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits'])
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey))

  // ECDH shared secret
  const receiverCK = await crypto.subtle.importKey('raw', receiverPubRaw, { name:'ECDH', namedCurve:'P-256' }, false, [])
  const ecdhSecret  = await crypto.subtle.deriveBits({ name:'ECDH', public: receiverCK }, senderKP.privateKey, 256)

  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // HKDF-SHA256: extract IKM
  const info_ikm = concat(enc.encode('WebPush: info\0'), receiverPubRaw, senderPubRaw)
  const ecdhKey  = await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits'])
  const ikm = await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt: authSecret, info: info_ikm }, ecdhKey, 256
  )

  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])

  // CEK (16 bytes) and Nonce (12 bytes)
  const info_cek   = concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([0]))
  const info_nonce = concat(enc.encode('Content-Encoding: nonce\0'),     new Uint8Array([0]))
  const cek   = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: info_cek   }, ikmKey, 128)
  const nonce = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: info_nonce }, ikmKey, 96)

  // Encrypt: plaintext + 0x02 delimiter
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const padded  = concat(plaintext, new Uint8Array([0x02]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name:'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded)
  )

  // aes128gcm header: salt(16) + rs(4 BE) + keyLen(1) + senderPub(65)
  const header = new Uint8Array(21 + senderPubRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = senderPubRaw.length
  header.set(senderPubRaw, 21)

  return concat(header, ciphertext)
}

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { recipient_id, payload } = await req.json().catch(() => ({}))
  if (!recipient_id || !payload) {
    return new Response(JSON.stringify({ error: 'missing recipient_id or payload' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const { data: subs, error: subErr } = await sb
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('profile_id', recipient_id)

  if (subErr || !subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: subErr?.message || 'no subscriptions' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const enc     = new TextEncoder()
  const isCall  = payload.type === 'call'
  const results = await Promise.allSettled(subs.map(async sub => {
    const body    = await encrypt(enc.encode(JSON.stringify(payload)), sub.keys_auth, sub.keys_p256dh)
    const jwt     = await vapidToken(sub.endpoint)
    const authHdr = `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization':    authHdr,
        'TTL':              isCall ? '30' : '86400',
        'Urgency':          isCall ? 'high' : 'normal',
      },
      body,
    })

    if (res.status === 410 || res.status === 404) {
      // Subscription expired — remove it
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
    if (!res.ok) throw new Error(`push ${res.status}: ${await res.text()}`)
    return true
  }))

  const sent   = results.filter(r => r.status === 'fulfilled').length
  const errors = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason?.message)

  return new Response(JSON.stringify({ sent, errors }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
