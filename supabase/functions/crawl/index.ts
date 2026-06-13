// crawl — seeds the signals table from OSM Overpass across world cities.
// Called by pg_cron every 30 min; also callable manually via POST /crawl.
// No JWT required (internal use only — verify secret header).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crawl-secret',
}

// 20 cities across every continent for global coverage
const SEED_CITIES = [
  { name: 'New York',      lat: 40.7128,  lng: -74.006  },
  { name: 'London',        lat: 51.5074,  lng: -0.1278  },
  { name: 'Tokyo',         lat: 35.6762,  lng: 139.6503 },
  { name: 'Paris',         lat: 48.8566,  lng: 2.3522   },
  { name: 'São Paulo',     lat: -23.5505, lng: -46.6333 },
  { name: 'Mumbai',        lat: 19.076,   lng: 72.8777  },
  { name: 'Lagos',         lat: 6.5244,   lng: 3.3792   },
  { name: 'Cairo',         lat: 30.0444,  lng: 31.2357  },
  { name: 'Sydney',        lat: -33.8688, lng: 151.2093 },
  { name: 'Mexico City',   lat: 19.4326,  lng: -99.1332 },
  { name: 'Berlin',        lat: 52.52,    lng: 13.405   },
  { name: 'Seoul',         lat: 37.5665,  lng: 126.978  },
  { name: 'Istanbul',      lat: 41.0082,  lng: 28.9784  },
  { name: 'Jakarta',       lat: -6.2088,  lng: 106.8456 },
  { name: 'Buenos Aires',  lat: -34.6037, lng: -58.3816 },
  { name: 'Nairobi',       lat: -1.2921,  lng: 36.8219  },
  { name: 'Los Angeles',   lat: 34.0522,  lng: -118.2437},
  { name: 'Singapore',     lat: 1.3521,   lng: 103.8198 },
  { name: 'Dubai',         lat: 25.2048,  lng: 55.2708  },
  { name: 'Johannesburg',  lat: -26.2041, lng: 28.0473  },
]

// OSM amenity/shop → signal_category + title template
// Coverage now spans every informant category that has a sensible OSM
// proxy: dating (nightclub/lounge), real_estate (estate_agent), classifieds
// (marketplace), sports (stadium/pitch), culture (museum/theatre/gallery),
// food (restaurant/cafe/bakery), travel (hotel/attraction).
const CATEGORY_MAP: Record<string, { cat: string; label: string }> = {
  // FOOD
  restaurant:   { cat: 'food',        label: 'Restaurant' },
  cafe:         { cat: 'food',        label: 'Café' },
  fast_food:    { cat: 'food',        label: 'Fast Food' },
  bakery:       { cat: 'food',        label: 'Bakery' },
  ice_cream:    { cat: 'food',        label: 'Ice Cream' },
  // DATING / NIGHTLIFE
  bar:          { cat: 'dating',      label: 'Bar' },
  nightclub:    { cat: 'dating',      label: 'Club' },
  pub:          { cat: 'dating',      label: 'Pub' },
  // COMMERCE
  pharmacy:     { cat: 'commerce',    label: 'Pharmacy' },
  supermarket:  { cat: 'commerce',    label: 'Supermarket' },
  convenience:  { cat: 'commerce',    label: 'Convenience Store' },
  clothes:      { cat: 'commerce',    label: 'Shop' },
  electronics:  { cat: 'commerce',    label: 'Electronics' },
  hairdresser:  { cat: 'commerce',    label: 'Salon' },
  bank:         { cat: 'commerce',    label: 'Bank' },
  // CLASSIFIEDS / MARKETPLACE
  marketplace:  { cat: 'classifieds', label: 'Marketplace' },
  // CULTURE
  museum:       { cat: 'culture',     label: 'Museum' },
  theatre:      { cat: 'culture',     label: 'Theatre' },
  cinema:       { cat: 'culture',     label: 'Cinema' },
  gallery:      { cat: 'culture',     label: 'Gallery' },
  library:      { cat: 'culture',     label: 'Library' },
  // SPORTS
  sports:       { cat: 'sports',      label: 'Sports' },
  stadium:      { cat: 'sports',      label: 'Stadium' },
  pitch:        { cat: 'sports',      label: 'Pitch' },
  gym:          { cat: 'sports',      label: 'Gym' },
  swimming_pool:{ cat: 'sports',      label: 'Pool' },
  // SCIENCE
  university:   { cat: 'science',     label: 'University' },
  research_institute: { cat: 'science', label: 'Research Institute' },
  // TRAVEL
  hotel:        { cat: 'travel',      label: 'Hotel' },
  hostel:       { cat: 'travel',      label: 'Hostel' },
  attraction:   { cat: 'travel',      label: 'Attraction' },
  viewpoint:    { cat: 'travel',      label: 'Viewpoint' },
  park:         { cat: 'travel',      label: 'Park' },
  // SOCIAL
  community_centre: { cat: 'social',  label: 'Community Centre' },
  // REAL ESTATE
  estate_agent: { cat: 'real_estate', label: 'Estate Agent' },
  // NEWS (civic)
  hospital:     { cat: 'news',        label: 'Hospital' },
  school:       { cat: 'news',        label: 'School' },
  books:        { cat: 'news',        label: 'Bookshop' },
}

async function crawlCity(city: { name: string; lat: number; lng: number }, radius = 2500): Promise<number> {
  const amenityList = Object.keys(CATEGORY_MAP).join('|')
  const query = `[out:json][timeout:20];
(
  node["amenity"~"^(${amenityList})$"](around:${radius},${city.lat},${city.lng});
  node["shop"~"^(clothes|electronics|books|sports|bakery|hairdresser|convenience|supermarket|estate_agent)$"](around:${radius},${city.lat},${city.lng});
  node["tourism"~"^(museum|attraction|gallery|hotel|hostel|viewpoint)$"](around:${radius},${city.lat},${city.lng});
  node["leisure"~"^(park|fitness_centre|sports_centre|stadium|pitch|swimming_pool)$"](around:${radius},${city.lat},${city.lng});
  node["office"~"^(estate_agent|research)$"](around:${radius},${city.lat},${city.lng});
)->._;
out body qt 80;`

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'AstranoV/1.0 crawler' },
    signal: AbortSignal.timeout(22000),
  })
  if (!resp.ok) throw new Error(`Overpass ${resp.status} for ${city.name}`)
  const data = await resp.json()
  return (data.elements ?? []).filter((e: any) => e.tags?.name && e.lat && e.lon).length
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Optional secret check for direct HTTP calls (pg_cron uses service role so no secret needed)
  const crawlSecret = Deno.env.get('CRAWL_SECRET')
  if (crawlSecret) {
    const provided = req.headers.get('x-crawl-secret')
    if (provided !== crawlSecret) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS })
    }
  }

  const body: any = await req.json().catch(() => ({}))
  // Allow caller to specify a subset of cities, or a single lat/lng
  const cities = body.cities ?? SEED_CITIES
  const radius = Number(body.radius) || 2500

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  // Process cities in batches of 4 to avoid hammering Overpass
  for (let i = 0; i < cities.length; i += 4) {
    const batch = cities.slice(i, i + 4)
    const amenityList = Object.keys(CATEGORY_MAP).join('|')

    await Promise.all(batch.map(async (city: any) => {
      try {
        const query = `[out:json][timeout:20];
(
  node["amenity"~"^(${amenityList})$"](around:${radius},${city.lat},${city.lng});
  node["shop"~"^(clothes|electronics|books|sports|bakery|hairdresser|convenience|supermarket|estate_agent)$"](around:${radius},${city.lat},${city.lng});
  node["tourism"~"^(museum|attraction|gallery|hotel|hostel|viewpoint)$"](around:${radius},${city.lat},${city.lng});
  node["leisure"~"^(park|fitness_centre|sports_centre|stadium|pitch|swimming_pool)$"](around:${radius},${city.lat},${city.lng});
  node["office"~"^(estate_agent|research)$"](around:${radius},${city.lat},${city.lng});
)->._;
out body qt 80;`

        const resp = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', body: query,
          headers: { 'Content-Type': 'text/plain', 'User-Agent': 'AstranoV/1.0' },
          signal: AbortSignal.timeout(22000),
        })
        if (!resp.ok) { errors.push(`${city.name}: HTTP ${resp.status}`); return }

        const data = await resp.json()
        const elements = (data.elements ?? []).filter((e: any) => e.tags?.name && e.lat && e.lon)

        const rows = elements.slice(0, 60).map((el: any) => {
          const amenity = el.tags.amenity ?? el.tags.shop ?? el.tags.tourism ?? el.tags.leisure ?? 'attraction'
          const meta = CATEGORY_MAP[amenity] ?? { cat: 'commerce', label: 'Place' }
          const name = el.tags.name as string
          const sourceUrl = `osm:node:${el.id}`
          return {
            title: name,
            body: [
              el.tags['addr:street'] ? `${el.tags['addr:street']}${el.tags['addr:housenumber'] ? ' ' + el.tags['addr:housenumber'] : ''}` : null,
              el.tags.opening_hours ?? null,
              el.tags.website ?? null,
            ].filter(Boolean).join(' · ') || `${meta.label} in ${city.name}`,
            category: meta.cat,
            scope: 'local',
            amplitude: 5,
            location: `SRID=4326;POINT(${el.lon} ${el.lat})`,
            source: 'crawler',
            source_url: sourceUrl,
            source_name: city.name,
            expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), // 7-day TTL
          }
        })

        if (rows.length === 0) return

        // Upsert on source_url to avoid duplicates
        const { data: upserted, error } = await sb
          .from('signals')
          .upsert(rows, { onConflict: 'source_url', ignoreDuplicates: true })
          .select('id')

        if (error) { errors.push(`${city.name}: ${error.message}`); return }
        inserted += upserted?.length ?? rows.length
      } catch (e: any) {
        errors.push(`${city.name}: ${e.message ?? e}`)
      }
    }))

    // Brief pause between batches to respect Overpass rate limits
    if (i + 4 < cities.length) await new Promise(r => setTimeout(r, 1500))
  }

  return new Response(JSON.stringify({ inserted, skipped, errors, cities: cities.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
