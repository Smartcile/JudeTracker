import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { routeCache } from "../db/schema.ts";
import { HttpError } from "../lib/http.ts";
import { parseOsrmDistance, routeCacheKey } from "../lib/osrm.ts";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const USER_AGENT = "JudeTracker/0.1 (self-hosted NZ mileage logbook)";
const MIN_GAP_MS = 1100; // be polite to the public demo server

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Driving distance in whole km between two points via the public OSRM demo
 * server, cached in Postgres forever so repeat legs work offline.
 */
export async function roadDistanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<number> {
  const key = routeCacheKey(from, to);
  const cached = (await db.select().from(routeCache).where(eq(routeCache.key, key)))[0];
  if (cached) return cached.km;

  const url = `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
  let json: unknown;
  try {
    const res = await throttled(() =>
      fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) }),
    );
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
    json = await res.json();
  } catch {
    throw new HttpError(502, "Road distance lookup unavailable — check the internet connection");
  }

  const meters = parseOsrmDistance(json);
  if (meters == null) throw new HttpError(502, "No road route found between those points");
  const km = Math.max(1, Math.round(meters / 1000));
  await db.insert(routeCache).values({ key, km }).onConflictDoNothing();
  return km;
}
