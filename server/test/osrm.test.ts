import { describe, expect, it } from "vitest";
import { parseOsrmDistance, routeCacheKey } from "../src/lib/osrm.ts";

describe("parseOsrmDistance", () => {
  it("reads the first route's distance in metres", () => {
    expect(parseOsrmDistance({ code: "Ok", routes: [{ distance: 24567.8, duration: 1200 }] })).toBe(24567.8);
  });

  it("returns null when there is no route", () => {
    expect(parseOsrmDistance({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseOsrmDistance({ code: "Ok" })).toBeNull();
    expect(parseOsrmDistance(null)).toBeNull();
    expect(parseOsrmDistance("nope")).toBeNull();
  });

  it("rejects zero or non-numeric distances", () => {
    expect(parseOsrmDistance({ routes: [{ distance: 0 }] })).toBeNull();
    expect(parseOsrmDistance({ routes: [{ distance: "12" }] })).toBeNull();
  });
});

describe("routeCacheKey", () => {
  it("rounds coordinates to ~11 m so nearby repeats share a cache row", () => {
    const a = routeCacheKey({ lat: -41.28651, lng: 174.77621 }, { lat: -41.1, lng: 174.6 });
    const b = routeCacheKey({ lat: -41.28654, lng: 174.77624 }, { lat: -41.1, lng: 174.6 });
    expect(a).toBe(b);
    expect(a).toBe("-41.2865,174.7762;-41.1000,174.6000");
  });
});
