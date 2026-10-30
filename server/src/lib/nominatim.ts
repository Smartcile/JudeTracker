import type { GeocodeResultDto } from "../../../shared/types.ts";

/** Cache key: lowercase, trimmed, internal whitespace collapsed. */
export function normalizeAddressQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Cache key for reverse lookups, rounded to ~1 m so repeat saves hit the cache. */
export function normalizeReverseKey(lat: number, lng: number): string {
  return `reverse:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Parse the Nominatim `/reverse?format=jsonv2` payload into our NZ address shape. */
export function parseNominatimReverse(json: unknown): GeocodeResultDto | null {
  if (typeof json !== "object" || json == null) return null;
  const row = json as { lat?: unknown; lon?: unknown; display_name?: unknown };
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  const label = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { label, lat, lng };
}

/** Parse the Nominatim `/search?format=jsonv2` payload into our NZ address shape. */
export function parseNominatim(json: unknown): GeocodeResultDto[] {
  if (!Array.isArray(json)) return [];
  const out: GeocodeResultDto[] = [];
  for (const raw of json) {
    if (typeof raw !== "object" || raw == null) continue;
    const row = raw as { lat?: unknown; lon?: unknown; display_name?: unknown };
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    const label = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ label, lat, lng });
  }
  return out;
}
