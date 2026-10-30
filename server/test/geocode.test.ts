import { describe, expect, it } from "vitest";
import {
  normalizeAddressQuery,
  normalizeReverseKey,
  parseNominatim,
  parseNominatimReverse,
} from "../src/lib/nominatim.ts";

describe("normalizeAddressQuery", () => {
  it("trims, collapses whitespace and lowercases", () => {
    expect(normalizeAddressQuery("  12  Kowhai   Rd  ")).toBe("12 kowhai rd");
  });

  it("gives the same key for casing/whitespace variants", () => {
    expect(normalizeAddressQuery("Auckland")).toBe(normalizeAddressQuery(" auckland "));
  });
});

describe("parseNominatim", () => {
  it("maps lat/lon strings and display_name", () => {
    const r = parseNominatim([
      { lat: "-41.2865", lon: "174.7762", display_name: "12 Kowhai Rd, Wellington, New Zealand" },
    ]);
    expect(r).toEqual([{ label: "12 Kowhai Rd, Wellington, New Zealand", lat: -41.2865, lng: 174.7762 }]);
  });

  it("skips malformed rows and non-arrays", () => {
    expect(parseNominatim(null)).toEqual([]);
    expect(parseNominatim({})).toEqual([]);
    expect(parseNominatim([null, "x", { lat: "abc", lon: "174", display_name: "Nowhere" }, { lat: "-41", lon: "174" }])).toEqual([]);
  });

  it("keeps only valid entries", () => {
    const r = parseNominatim([
      { lat: "-41.2865", lon: "174.7762", display_name: "Good" },
      { lat: "oops", lon: "174.7762", display_name: "Bad" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.label).toBe("Good");
  });
});

describe("normalizeReverseKey", () => {
  it("rounds to six decimals so repeat saves share a cache key", () => {
    expect(normalizeReverseKey(-41.28651234, 174.77629876)).toBe(normalizeReverseKey(-41.286512, 174.776299));
  });

  it("prefixes reverse lookups so they cannot collide with address searches", () => {
    expect(normalizeReverseKey(-41, 174)).toBe("reverse:-41.000000,174.000000");
  });
});

describe("parseNominatimReverse", () => {
  it("maps a reverse payload to an address", () => {
    expect(
      parseNominatimReverse({ lat: "-41.2865", lon: "174.7762", display_name: "12 Kowhai Rd, Wellington, New Zealand" }),
    ).toEqual({ label: "12 Kowhai Rd, Wellington, New Zealand", lat: -41.2865, lng: 174.7762 });
  });

  it("returns null for malformed or empty payloads", () => {
    expect(parseNominatimReverse(null)).toBeNull();
    expect(parseNominatimReverse({ error: "Unable to geocode" })).toBeNull();
    expect(parseNominatimReverse({ lat: "-41", lon: "174" })).toBeNull();
    expect(parseNominatimReverse({ lat: "abc", lon: "174", display_name: "Nowhere" })).toBeNull();
  });
});
