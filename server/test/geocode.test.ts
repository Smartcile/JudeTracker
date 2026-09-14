import { describe, expect, it } from "vitest";
import { normalizeAddressQuery, parseNominatim } from "../src/lib/nominatim.ts";

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
