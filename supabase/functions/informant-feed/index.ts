// informant-feed v6 — RSS-driven, richer geo recogniser.
// Source: public RSS feeds (BBC, Al Jazeera, Guardian, DW). Each
// informant category maps to 2-4 feeds; the function fans out, parses
// the RSS/Atom with regex, geo-tags each headline via a 100+ entry
// country/city/adjective lookup, and caches 4 minutes in module scope.
// No auth required — these are public news feeds.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const CENTERS: Record<string, [number, number]> = {
  'united states': [39.8, -98.6], 'usa': [39.8, -98.6], 'america': [39.8, -98.6], 'us': [39.8, -98.6],
  'united kingdom': [54.0, -2.0], 'britain': [54.0, -2.0], 'england': [52.5, -1.5], 'scotland': [56.5, -4.2], 'wales': [52.3, -3.7], 'london': [51.5, -0.13], 'uk': [54.0, -2.0],
  'greece': [39.0, 22.0], 'athens': [37.98, 23.73],
  'germany': [51.0, 10.0], 'berlin': [52.52, 13.4],
  'france': [46.5, 2.5], 'paris': [48.86, 2.35],
  'italy': [42.5, 12.5], 'rome': [41.9, 12.5],
  'spain': [40.0, -3.7], 'madrid': [40.4, -3.7],
  'russia': [60.0, 100.0], 'moscow': [55.75, 37.6],
  'china': [35.0, 105.0], 'beijing': [39.9, 116.4], 'shanghai': [31.23, 121.47],
  'japan': [36.2, 138.0], 'tokyo': [35.68, 139.69],
  'india': [22.0, 79.0], 'delhi': [28.6, 77.2], 'mumbai': [19.07, 72.87],
  'brazil': [-10.3, -53.0], 'rio': [-22.9, -43.2], 'são paulo': [-23.55, -46.63],
  'canada': [56.1, -106.3], 'toronto': [43.65, -79.38], 'ottawa': [45.42, -75.69],
  'australia': [-25.3, 133.8], 'sydney': [-33.87, 151.2], 'melbourne': [-37.81, 144.96],
  'mexico': [23.6, -102.5],
  'egypt': [26.8, 30.8], 'cairo': [30.04, 31.24],
  'south africa': [-30.6, 22.9],
  'nigeria': [9.1, 8.7],
  'kenya': [-0.0, 37.9], 'nairobi': [-1.29, 36.82],
  'argentina': [-38.4, -63.6], 'buenos aires': [-34.6, -58.4],
  'turkey': [38.96, 35.24], 'türkiye': [38.96, 35.24], 'istanbul': [41.0, 28.97],
  'poland': [51.9, 19.1], 'warsaw': [52.23, 21.01],
  'netherlands': [52.1, 5.3], 'amsterdam': [52.37, 4.9],
  'belgium': [50.5, 4.5], 'brussels': [50.85, 4.35],
  'sweden': [60.1, 18.6], 'stockholm': [59.33, 18.07],
  'norway': [60.5, 8.5], 'oslo': [59.91, 10.75],
  'finland': [61.9, 25.7], 'helsinki': [60.17, 24.94],
  'denmark': [56.3, 9.5], 'copenhagen': [55.68, 12.57],
  'ireland': [53.4, -8.0], 'dublin': [53.35, -6.26],
  'portugal': [39.4, -8.2], 'lisbon': [38.72, -9.14],
  'switzerland': [46.8, 8.2],
  'austria': [47.5, 14.5], 'vienna': [48.21, 16.37],
  'israel': [31.0, 34.9], 'tel aviv': [32.08, 34.78], 'jerusalem': [31.78, 35.21],
  'saudi arabia': [23.9, 45.1], 'riyadh': [24.7, 46.7],
  'united arab emirates': [23.4, 53.8], 'dubai': [25.2, 55.27], 'uae': [23.4, 53.8],
  'iran': [32.4, 53.7], 'tehran': [35.69, 51.39],
  'iraq': [33.2, 43.7], 'baghdad': [33.31, 44.36],
  'syria': [34.8, 38.9],
  'ukraine': [48.4, 31.2], 'kyiv': [50.45, 30.52], 'kiev': [50.45, 30.52],
  'south korea': [35.9, 127.8], 'seoul': [37.57, 126.98],
  'north korea': [40.3, 127.5],
  'thailand': [15.9, 100.9], 'bangkok': [13.75, 100.5],
  'vietnam': [14.1, 108.3], 'hanoi': [21.03, 105.85],
  'indonesia': [-0.8, 113.9], 'jakarta': [-6.21, 106.85],
  'philippines': [12.9, 121.8], 'manila': [14.6, 121.0],
  'malaysia': [4.2, 101.9], 'kuala lumpur': [3.14, 101.69],
  'singapore': [1.35, 103.8],
  'hong kong': [22.32, 114.17],
  'taiwan': [23.7, 121.0], 'taipei': [25.03, 121.57],
  'new zealand': [-40.9, 174.9],
  'chile': [-35.7, -71.5],
  'colombia': [4.6, -74.3],
  'peru': [-9.2, -75.0],
  'venezuela': [6.4, -66.6],
  'pakistan': [30.4, 69.3],
  'bangladesh': [23.7, 90.4],
  'czech republic': [49.8, 15.5], 'czechia': [49.8, 15.5],
  'romania': [45.9, 24.97], 'bucharest': [44.43, 26.1],
  'hungary': [47.16, 19.5], 'budapest': [47.5, 19.04],
  'morocco': [31.8, -7.1],
  'algeria': [28.0, 1.7],
  'tunisia': [33.9, 9.6],
  'lebanon': [33.85, 35.86],
  'jordan': [30.6, 36.2],
  'qatar': [25.4, 51.2], 'doha': [25.29, 51.53],
  'kuwait': [29.3, 47.6],
  'oman': [21.5, 55.9],
  'cyprus': [35.13, 33.43],
  'gaza': [31.5, 34.45],
  'palestine': [31.95, 35.23],
  'yemen': [15.55, 48.52],
  'afghanistan': [33.94, 67.71],
  'belarus': [53.71, 27.95], 'minsk': [53.9, 27.57],
  'kazakhstan': [48.02, 66.92],
  'libya': [26.34, 17.23],
  'sudan': [12.86, 30.22],
  'cuba': [21.52, -77.78], 'havana': [23.13, -82.38],
  'senegal': [14.5, -14.5], 'dakar': [14.7, -17.4],
  'sri lanka': [7.87, 80.77],
  'myanmar': [21.91, 95.96], 'burma': [21.91, 95.96],
  'nepal': [28.39, 84.12],
  'ghana': [7.95, -1.0],
  'tanzania': [-6.4, 34.9],
  'uganda': [1.4, 32.3],
  'ethiopia': [9.1, 40.5],
  'european union': [50.85, 4.35],
  'european council': [50.85, 4.35],
  'eu': [50.85, 4.35],
}

const ADJ_TO_COUNTRY: Record<string, string> = {
  chinese: 'china', german: 'germany', french: 'france', italian: 'italy',
  japanese: 'japan', spanish: 'spain', russian: 'russia', indian: 'india',
  brazilian: 'brazil', mexican: 'mexico', canadian: 'canada',
  australian: 'australia', egyptian: 'egypt', turkish: 'turkey',
  iranian: 'iran', iraqi: 'iraq', syrian: 'syria',
  ukrainian: 'ukraine', korean: 'south korea', vietnamese: 'vietnam',
  thai: 'thailand', indonesian: 'indonesia', filipino: 'philippines',
  pakistani: 'pakistan', afghan: 'afghanistan', israeli: 'israel',
  palestinian: 'palestine', lebanese: 'lebanon', jordanian: 'jordan',
  saudi: 'saudi arabia', emirati: 'united arab emirates',
  nigerian: 'nigeria', kenyan: 'kenya', ethiopian: 'ethiopia',
  moroccan: 'morocco', algerian: 'algeria', tunisian: 'tunisia',
  libyan: 'libya', sudanese: 'sudan', argentinian: 'argentina',
  chilean: 'chile', colombian: 'colombia', peruvian: 'peru',
  venezuelan: 'venezuela', cuban: 'cuba', irish: 'ireland',
  scottish: 'scotland', welsh: 'wales', british: 'united kingdom',
  dutch: 'netherlands', swedish: 'sweden', norwegian: 'norway',
  finnish: 'finland', danish: 'denmark', polish: 'poland',
  austrian: 'austria', swiss: 'switzerland', belgian: 'belgium',
  portuguese: 'portugal', greek: 'greece', hellenic: 'greece',
  romanian: 'romania', hungarian: 'hungary', czech: 'czech republic',
  serbian: 'serbia', croatian: 'croatia', bulgarian: 'bulgaria',
  belarusian: 'belarus', kazakh: 'kazakhstan',
  taiwanese: 'taiwan', singaporean: 'singapore',
  senegalese: 'senegal', european: 'european union', americans: 'united states',
  american: 'united states', europeans: 'european union',
}

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function extractGeo(title: string): { country: string; coords: [number, number] } | null {
  if (!title) return null
  const t = ' ' + title.toLowerCase().replace(/[‘’]/g, "'") + ' '
  const centerKeys = Object.keys(CENTERS).sort((a, b) => b.length - a.length)
  const pad = `[\\s,.!?;:'"()\\-—–]`
  for (const k of centerKeys) {
    const re = new RegExp(`${pad}${esc(k)}${pad}`, 'i')
    if (re.test(t)) return { country: k, coords: CENTERS[k] }
  }
  for (const adj of Object.keys(ADJ_TO_COUNTRY)) {
    const re = new RegExp(`${pad}${esc(adj)}${pad}`, 'i')
    if (re.test(t)) {
      const country = ADJ_TO_COUNTRY[adj]
      const c = CENTERS[country]
      if (c) return { country, coords: c }
    }
  }
  return null
}

const CATEGORY_FEEDS: Record<string, string[]> = {
  news: [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.theguardian.com/world/rss',
    'https://rss.dw.com/rdf/rss-en-world',
  ],
  jobs: [
    'https://www.theguardian.com/money/work-and-careers/rss',
    'https://feeds.bbci.co.uk/news/business/your_money/rss.xml',
  ],
  commerce: [
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    'https://www.theguardian.com/business/rss',
    'https://rss.dw.com/rdf/rss-en-bus',
  ],
  social: [
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://www.theguardian.com/technology/rss',
  ],
  dating: [
    'https://www.theguardian.com/lifeandstyle/relationships/rss',
  ],
  real_estate: [
    'https://www.theguardian.com/money/property/rss',
  ],
  classifieds: [
    'https://www.theguardian.com/business/rss',
  ],
}

interface Item {
  title: string; link: string; description: string; pubDate: string;
  image: string; source: string;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
}
function stripTags(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
}
function extractTag(item: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = item.match(re)
  return m ? decodeEntities(stripTags(m[1])).trim() : ''
}
function extractImage(item: string): string {
  const enc = item.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image\/[^"]*"/i)
  if (enc) return enc[1]
  const mt = item.match(/<media:thumbnail[^>]+url="([^"]+)"/i)
  if (mt) return mt[1]
  const mc = item.match(/<media:content[^>]+url="([^"]+)"/i)
  if (mc) return mc[1]
  const im = item.match(/<image[^>]*>[\s\S]*?<url>([^<]+)<\/url>/i)
  if (im) return im[1]
  const ig = item.match(/<img[^>]+src="([^"]+)"/i)
  if (ig) return ig[1]
  return ''
}

async function fetchFeed(url: string): Promise<Item[]> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'AstranoV-InformantFeed/1.0 (+https://astranov.eu)',
        'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      },
    })
    if (!r.ok) return []
    const text = await r.text()
    if (!text || text.length < 100) return []
    const items: Item[] = []
    const re = /<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi
    const matches = text.match(re) || []
    for (const raw of matches.slice(0, 25)) {
      const title = extractTag(raw, 'title')
      let link = extractTag(raw, 'link')
      if (!link) {
        const lm = raw.match(/<link[^>]+href="([^"]+)"/i)
        if (lm) link = lm[1]
      }
      const description = extractTag(raw, 'description') || extractTag(raw, 'summary')
      const pubDate = extractTag(raw, 'pubDate') || extractTag(raw, 'updated') || extractTag(raw, 'published')
      const image = extractImage(raw)
      if (!title) continue
      items.push({
        title, link, description, pubDate, image,
        source: new URL(url).hostname.replace(/^www\./, ''),
      })
    }
    return items
  } catch { return [] }
}

const CACHE = new Map<string, { ts: number; items: Item[] }>()
const CACHE_TTL_MS = 4 * 60 * 1000
async function cachedFeed(url: string): Promise<Item[]> {
  const c = CACHE.get(url)
  const now = Date.now()
  if (c && (now - c.ts) < CACHE_TTL_MS) return c.items
  const items = await fetchFeed(url)
  if (items.length) CACHE.set(url, { ts: now, items })
  return items
}

function stableId(link: string): string {
  let h = 0
  for (let i = 0; i < link.length; i++) h = ((h * 31) + link.charCodeAt(i)) | 0
  return 'rss:' + Math.abs(h).toString(36)
}
function parsePubDate(s: string): string {
  if (!s) return new Date().toISOString()
  const d = new Date(s)
  return isNaN(d.valueOf()) ? new Date().toISOString() : d.toISOString()
}
function topicMatch(title: string, description: string, topic: string): boolean {
  if (!topic) return true
  const t = topic.trim().toLowerCase()
  if (!t) return true
  const hay = (title + ' ' + (description || '')).toLowerCase()
  return t.split(/[\s,]+/).filter(Boolean).some(k => hay.includes(k))
}
function mapFinding(it: Item, category: string) {
  const geo = extractGeo(it.title) || extractGeo(it.description)
  return {
    id: stableId(it.link || it.title),
    title: (it.title || '').slice(0, 220),
    url: it.link || '',
    source_name: it.source || '',
    image_url: it.image || '',
    country_code: geo ? geo.country : '',
    lat: geo ? geo.coords[0] : null,
    lng: geo ? geo.coords[1] : null,
    category,
    created_at: parsePubDate(it.pubDate),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const informants: Array<{ id: string; category?: string; topic?: string }> =
      Array.isArray(body.informants) ? body.informants.slice(0, 12) : []
    if (!informants.length) return json({ ok: true, findings: {} })

    const urlSet = new Set<string>()
    for (const inf of informants) {
      const feeds = CATEGORY_FEEDS[inf.category || 'news'] || CATEGORY_FEEDS.news
      feeds.forEach(u => urlSet.add(u))
    }
    const feedResults = new Map<string, Item[]>()
    await Promise.all([...urlSet].map(async (u) => {
      feedResults.set(u, await cachedFeed(u))
    }))

    const findings: Record<string, unknown[]> = {}
    for (const inf of informants) {
      const cat = inf.category || 'news'
      const topic = inf.topic || ''
      const feeds = CATEGORY_FEEDS[cat] || CATEGORY_FEEDS.news
      const merged: Item[] = []
      for (const f of feeds) (feedResults.get(f) || []).forEach(p => merged.push(p))
      const filtered = merged.filter(p => topicMatch(p.title, p.description, topic))
      filtered.sort((a, b) => {
        const ta = new Date(a.pubDate || 0).valueOf() || 0
        const tb = new Date(b.pubDate || 0).valueOf() || 0
        if (tb !== ta) return tb - ta
        return (b.image ? 1 : 0) - (a.image ? 1 : 0)
      })
      const seen = new Set<string>()
      const top: Item[] = []
      for (const p of filtered) {
        const key = p.link || p.title
        if (seen.has(key)) continue
        seen.add(key); top.push(p)
        if (top.length >= 6) break
      }
      findings[inf.id] = top.map(p => mapFinding(p, cat))
    }
    return json({ ok: true, findings, fetched_at: new Date().toISOString(), feeds_fetched: urlSet.size })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
