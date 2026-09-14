const round4 = (n: number) => n.toFixed(4);

/** Cache key for a road route, rounded to ~11 m so repeat trips hit the cache. */
export function routeCacheKey(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): string {
  return `${round4(from.lat)},${round4(from.lng)};${round4(to.lat)},${round4(to.lng)}`;
}

/** OSRM route distance in metres, or null when the response has no usable route. */
export function parseOsrmDistance(json: unknown): number | null {
  if (typeof json !== "object" || json == null) return null;
  const routes = (json as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const distance = (routes[0] as { distance?: unknown } | undefined)?.distance;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) return null;
  return distance;
}
