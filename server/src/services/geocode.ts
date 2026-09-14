import { eq } from "drizzle-orm";
import type { GeocodeResultDto } from "../../../shared/types.ts";
import { db } from "../db/index.ts";
import { geocodeCache } from "../db/schema.ts";
import { HttpError } from "../lib/http.ts";
import { normalizeAddressQuery, parseNominatim } from "../lib/nominatim.ts";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "JudeTracker/0.1 (self-hosted NZ mileage logbook)";
const MIN_GAP_MS = 1100; // Nominatim asks for at most 1 request/second

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
 * NZ address lookup: Postgres-cached Nominatim search. Repeat lookups (and
 * everything already searched) keep working when the internet is down.
 */
export async function geocodeNZ(query: string): Promise<GeocodeResultDto[]> {
  const key = normalizeAddressQuery(query);
  const cached = (await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)))[0];
  if (cached) return cached.results;

  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "nz",
    limit: "6",
  })}`;

  let json: unknown;
  try {
    const res = await throttled(() => fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) }));
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    json = await res.json();
  } catch {
    throw new HttpError(502, "Address lookup unavailable — check the internet connection, or enter coordinates instead");
  }

  const results = parseNominatim(json);
  await db.insert(geocodeCache).values({ query: key, results }).onConflictDoNothing();
  return results;
}
