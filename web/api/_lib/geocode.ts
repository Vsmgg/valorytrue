export interface Coordenadas {
  lat: number
  lon: number
}

/**
 * Free, keyless geocoding via Nominatim (OpenStreetMap). Nominatim's usage policy asks
 * for light, non-bulk use (roughly 1 request/second, a descriptive User-Agent, no
 * concurrent requests) — fine at this app's per-evaluation call volume, but would need
 * a paid geocoding provider (Google/Mapbox) if usage ever scales up significantly.
 */
export async function geocodeEndereco(endereco: string): Promise<Coordenadas | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RealvaImobiliarioAI/1.0 (plataforma de avaliação imobiliária com IA)' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error('[geocode] non-OK response', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = (await res.json()) as { lat?: string; lon?: string }[]
    const first = data[0]
    if (!first?.lat || !first?.lon) {
      console.error('[geocode] no result for', endereco)
      return null
    }
    const lat = Number(first.lat)
    const lon = Number(first.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon }
  } catch (err) {
    console.error('[geocode] error for', endereco, String(err))
    return null
  }
}

export function haversineMeters(a: Coordenadas, b: Coordenadas): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(s)))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
