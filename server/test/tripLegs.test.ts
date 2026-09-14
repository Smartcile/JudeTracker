import { describe, expect, it } from "vitest";
import { buildNextTrip, buildReturnLog } from "../src/lib/tripLegs.ts";

const homeBase = { address: "1 Home Rd, Wellington", lat: -41.1, lng: 174.6 };
const arriveAt = new Date("2026-09-14T10:25:00Z");
const now = new Date("2026-09-14T11:00:00Z");
const timezone = "Pacific/Auckland";

describe("buildReturnLog", () => {
  it("creates a manual home-base arrival log without a photo", () => {
    const v = buildReturnLog({ vehicleId: 1, homeBase, arriveAt });
    expect(v.vehicleId).toBe(1);
    expect(v.takenAt).toEqual(arriveAt);
    expect(v.lat).toBe(-41.1);
    expect(v.lng).toBe(174.6);
    expect(v.locationLabel).toBe("1 Home Rd, Wellington");
    expect(v.gpsSource).toBe("manual");
    expect(v.hasPhoto).toBe(false);
  });

  it("labels the home base when no address is set", () => {
    const v = buildReturnLog({ vehicleId: 1, homeBase: { address: "", lat: -41.1, lng: 174.6 }, arriveAt });
    expect(v.locationLabel).toBe("Home base");
  });
});

describe("buildNextTrip", () => {
  const endLog = {
    vehicleId: 1,
    takenAt: new Date("2026-09-14T10:25:00Z"),
    lat: -41.2,
    lng: 174.7,
    locationLabel: "12 Kowhai Rd, Wellington",
    readingKm: 100230,
  };
  const job = { vehicleId: 1, location: "12 KOWHAI RD, WELLINGTON", locationLat: null, locationLng: null };

  it("starts where the previous trip ended: time, place and odometer", () => {
    const v = buildNextTrip({ job, fromLog: endLog, now, timezone });
    expect(v.startLog.takenAt).toEqual(endLog.takenAt);
    expect(v.startLog.lat).toBe(-41.2);
    expect(v.startLog.lng).toBe(174.7);
    expect(v.startLog.locationLabel).toBe("12 Kowhai Rd, Wellington");
    expect(v.startLog.gpsSource).toBe("manual");
    expect(v.startLog.readingKm).toBe(100230);
    expect(v.startLog.hasPhoto).toBe(false);
  });

  it("starts from the return (home) reading when the trip has one", () => {
    const returnLog = { ...endLog, takenAt: new Date("2026-09-14T11:00:00Z"), lat: -41.1, lng: 174.6, locationLabel: "1 Home Rd", readingKm: 100260 };
    const v = buildNextTrip({ job, fromLog: returnLog, now, timezone });
    expect(v.startLog.takenAt).toEqual(returnLog.takenAt);
    expect(v.startLog.lat).toBe(-41.1);
    expect(v.startLog.locationLabel).toBe("1 Home Rd");
    expect(v.startLog.readingKm).toBe(100260);
  });

  it("creates a business trip with no calendar event", () => {
    const v = buildNextTrip({ job, fromLog: endLog, now, timezone });
    expect(v.job.tripKind).toBe("business");
    expect(v.job.eventUid).toBeNull();
    expect(v.job.vehicleId).toBe(1);
    expect(v.job.client).toContain("BUSINESS TRIP");
  });

  it("dates the trip by the copied start time's local day", () => {
    const v = buildNextTrip({
      job,
      fromLog: { ...endLog, takenAt: new Date("2026-09-14T13:00:00Z") }, // 01:00 on the 15th in NZ
      now,
      timezone,
    });
    expect(v.job.jobDate).toBe("2026-09-15");
  });

  it("falls back to the trip's own location when the last log has no label or point", () => {
    const v = buildNextTrip({
      job: { vehicleId: null, location: "8 TAWA ST, WELLINGTON", locationLat: -41.3, locationLng: 174.8 },
      fromLog: { ...endLog, vehicleId: null, lat: null, lng: null, locationLabel: "", readingKm: null },
      now,
      timezone,
    });
    expect(v.startLog.lat).toBe(-41.3);
    expect(v.startLog.lng).toBe(174.8);
    expect(v.startLog.locationLabel).toBe("8 TAWA ST, WELLINGTON");
    expect(v.startLog.readingKm).toBeNull();
    expect(v.startLog.vehicleId).toBeNull();
  });

  it("falls back to now and no point when the trip has no logs", () => {
    const v = buildNextTrip({
      job: { vehicleId: null, location: "", locationLat: null, locationLng: null },
      fromLog: undefined,
      now,
      timezone,
    });
    expect(v.startLog.takenAt).toEqual(now);
    expect(v.startLog.lat).toBeNull();
    expect(v.startLog.lng).toBeNull();
    expect(v.startLog.locationLabel).toBe("");
    expect(v.startLog.gpsSource).toBe("none");
  });
});
