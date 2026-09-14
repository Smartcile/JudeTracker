import { describe, expect, it } from "vitest";
import { jobCreateBody, jobPatchBody, logFields, logPatchBody, placeBody, returnLogBody, settingsBody } from "../src/lib/validation.ts";

describe("jobPatchBody", () => {
  it("accepts jobDate in YYYY-MM-DD", () => {
    const r = jobPatchBody.parse({ jobDate: "2026-09-10" });
    expect(r.jobDate).toBe("2026-09-10");
  });

  it("rejects malformed jobDate", () => {
    expect(() => jobPatchBody.parse({ jobDate: "10/09/2026" })).toThrow();
    expect(() => jobPatchBody.parse({ jobDate: "2026-13-01" })).toThrow();
  });

  it("accepts a positive vehicleId and null", () => {
    expect(jobPatchBody.parse({ vehicleId: 3 }).vehicleId).toBe(3);
    expect(jobPatchBody.parse({ vehicleId: null }).vehicleId).toBeNull();
  });

  it("rejects non-positive or non-numeric vehicleId", () => {
    expect(() => jobPatchBody.parse({ vehicleId: 0 })).toThrow();
    expect(() => jobPatchBody.parse({ vehicleId: -2 })).toThrow();
    expect(() => jobPatchBody.parse({ vehicleId: "abc" })).toThrow();
  });

  it("keeps existing text fields working", () => {
    const r = jobPatchBody.parse({ client: "  Sarah  ", notes: "x" });
    expect(r.client).toBe("SARAH");
    expect(r.notes).toBe("X");
  });
});

describe("jobCreateBody", () => {
  it("validates jobDate shape", () => {
    expect(() => jobCreateBody.parse({ jobDate: "2026-9-1" })).toThrow();
    expect(jobCreateBody.parse({ jobDate: "2026-09-01" }).jobDate).toBe("2026-09-01");
  });
});

describe("logPatchBody", () => {
  it("accepts a takenAt timestamp", () => {
    const r = logPatchBody.parse({ takenAt: "2026-09-10T04:00:00.000Z" });
    expect(new Date(r.takenAt!).toISOString()).toBe("2026-09-10T04:00:00.000Z");
  });

  it("rejects a garbage timestamp", () => {
    expect(() => logPatchBody.parse({ takenAt: "not-a-date" })).toThrow();
  });

  it("accepts lat+lng as a pair", () => {
    const r = logPatchBody.parse({ lat: -41.2865, lng: 174.7762 });
    expect(r.lat).toBe(-41.2865);
    expect(r.lng).toBe(174.7762);
  });

  it("accepts clearing the pair with nulls", () => {
    const r = logPatchBody.parse({ lat: null, lng: null });
    expect(r.lat).toBeNull();
    expect(r.lng).toBeNull();
  });

  it("rejects lat without lng or lng without lat", () => {
    expect(() => logPatchBody.parse({ lat: -41.2 })).toThrow();
    expect(() => logPatchBody.parse({ lng: 174.7 })).toThrow();
  });

  it("rejects one side null and the other set", () => {
    expect(() => logPatchBody.parse({ lat: null, lng: 174.7 })).toThrow();
    expect(() => logPatchBody.parse({ lat: -41.2, lng: null })).toThrow();
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => logPatchBody.parse({ lat: 91, lng: 174.7 })).toThrow();
    expect(() => logPatchBody.parse({ lat: -41.2, lng: 181 })).toThrow();
  });

  it("accepts an empty patch and lets the route say nothing-to-update", () => {
    expect(logPatchBody.parse({})).toEqual({});
  });

  it("accepts a location label on its own", () => {
    expect(logPatchBody.parse({ locationLabel: "  12 Kowhai Rd  " }).locationLabel).toBe("12 Kowhai Rd");
  });

  it("rejects an over-long location label", () => {
    expect(() => logPatchBody.parse({ locationLabel: "x".repeat(201) })).toThrow();
  });
});

describe("logFields", () => {
  it("defaults the location label to empty", () => {
    expect(logFields.parse({}).locationLabel).toBe("");
  });

  it("keeps a picked place's label", () => {
    expect(logFields.parse({ locationLabel: "1 Home Rd" }).locationLabel).toBe("1 Home Rd");
  });
});

describe("settingsBody", () => {
  it("accepts a partial update", () => {
    const r = settingsBody.parse({ homeBaseAddress: "1 Home Rd" });
    expect(r.homeBaseAddress).toBe("1 Home Rd");
  });

  it("accepts home base coordinates as a pair", () => {
    const r = settingsBody.parse({ homeBaseLat: -41.1, homeBaseLng: 174.6 });
    expect(r.homeBaseLat).toBe(-41.1);
    expect(r.homeBaseLng).toBe(174.6);
  });

  it("accepts clearing the home base coordinates", () => {
    const r = settingsBody.parse({ homeBaseLat: null, homeBaseLng: null });
    expect(r.homeBaseLat).toBeNull();
    expect(r.homeBaseLng).toBeNull();
  });

  it("rejects a half-set home base", () => {
    expect(() => settingsBody.parse({ homeBaseLat: -41.1 })).toThrow();
    expect(() => settingsBody.parse({ homeBaseLng: 174.6 })).toThrow();
    expect(() => settingsBody.parse({ homeBaseLat: -41.1, homeBaseLng: null })).toThrow();
    expect(() => settingsBody.parse({ homeBaseLat: null, homeBaseLng: 174.6 })).toThrow();
  });

  it("rejects out-of-range home base coordinates", () => {
    expect(() => settingsBody.parse({ homeBaseLat: -91, homeBaseLng: 174.6 })).toThrow();
    expect(() => settingsBody.parse({ homeBaseLat: -41.1, homeBaseLng: 181 })).toThrow();
  });
});

describe("returnLogBody", () => {
  it("accepts an arrival after departure", () => {
    const r = returnLogBody.parse({ departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T10:25:00Z" });
    expect(new Date(r.arriveAt).getTime()).toBeGreaterThan(new Date(r.departAt).getTime());
  });

  it("accepts an optional whole-km distance", () => {
    const r = returnLogBody.parse({ departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T10:25:00Z", distanceKm: 25 });
    expect(r.distanceKm).toBe(25);
    const none = returnLogBody.parse({ departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T10:25:00Z" });
    expect(none.distanceKm).toBeUndefined();
  });

  it("rejects fractional, zero or absurd distances", () => {
    const base = { departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T10:25:00Z" };
    expect(() => returnLogBody.parse({ ...base, distanceKm: 2.5 })).toThrow();
    expect(() => returnLogBody.parse({ ...base, distanceKm: 0 })).toThrow();
    expect(() => returnLogBody.parse({ ...base, distanceKm: 5000 })).toThrow();
  });

  it("rejects an arrival before or at departure", () => {
    expect(() => returnLogBody.parse({ departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T09:55:00Z" })).toThrow();
    expect(() => returnLogBody.parse({ departAt: "2026-09-14T10:00:00Z", arriveAt: "2026-09-14T10:00:00Z" })).toThrow();
  });

  it("rejects garbage timestamps", () => {
    expect(() => returnLogBody.parse({ departAt: "nope", arriveAt: "2026-09-14T10:25:00Z" })).toThrow();
  });
});

describe("placeBody", () => {
  it("accepts a named place with coordinates", () => {
    const r = placeBody.parse({ name: "  Sarah's place ", address: "12 Kowhai Rd", lat: -41.28, lng: 174.77 });
    expect(r.name).toBe("Sarah's place");
    expect(r.address).toBe("12 Kowhai Rd");
  });

  it("defaults a missing address", () => {
    expect(placeBody.parse({ name: "Gym", lat: -41.28, lng: 174.77 }).address).toBe("");
  });

  it("rejects a blank name or out-of-range coordinates", () => {
    expect(() => placeBody.parse({ name: "  ", lat: -41.28, lng: 174.77 })).toThrow();
    expect(() => placeBody.parse({ name: "Gym", lat: -91, lng: 174.77 })).toThrow();
    expect(() => placeBody.parse({ name: "Gym", lat: -41.28, lng: 181 })).toThrow();
  });
});
