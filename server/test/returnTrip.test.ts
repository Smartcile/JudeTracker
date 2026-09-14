import { describe, expect, it } from "vitest";
import { buildReturnTrip } from "../src/lib/returnTrip.ts";

const job = { client: "ACME", tripKind: "business", vehicleId: 1 };
const homeBase = { address: "1 Home Rd, Wellington", lat: -41.1, lng: 174.6 };
const departAt = new Date("2026-09-14T10:00:00Z");
const arriveAt = new Date("2026-09-14T10:25:00Z");
const timezone = "Pacific/Auckland";

describe("buildReturnTrip", () => {
  it("creates a companion job with both manual logs", () => {
    const v = buildReturnTrip({ job, outboundEnd: { lat: -41.2, lng: 174.7 }, homeBase, departAt, arriveAt, timezone });
    expect(v.job.client).toBe("ACME");
    expect(v.job.location).toBe("1 Home Rd, Wellington");
    expect(v.job.notes).toContain("Return leg");
    expect(v.job.tripKind).toBe("business");
    expect(v.job.vehicleId).toBe(1);
    expect(v.job.eventUid).toBeNull();
    expect(v.startLog.takenAt).toEqual(departAt);
    expect(v.endLog.takenAt).toEqual(arriveAt);
    expect(v.startLog.hasPhoto).toBe(false);
    expect(v.endLog.hasPhoto).toBe(false);
  });

  it("starts the return leg where the outbound trip ended", () => {
    const v = buildReturnTrip({ job, outboundEnd: { lat: -41.2, lng: 174.7 }, homeBase, departAt, arriveAt, timezone });
    expect(v.startLog.lat).toBe(-41.2);
    expect(v.startLog.lng).toBe(174.7);
    expect(v.startLog.gpsSource).toBe("manual");
  });

  it("leaves the start point empty when the outbound has no coordinates", () => {
    const v = buildReturnTrip({ job, outboundEnd: undefined, homeBase, departAt, arriveAt, timezone });
    expect(v.startLog.lat).toBeNull();
    expect(v.startLog.lng).toBeNull();
    expect(v.startLog.gpsSource).toBe("none");
  });

  it("finishes at the home base", () => {
    const v = buildReturnTrip({ job, outboundEnd: undefined, homeBase, departAt, arriveAt, timezone });
    expect(v.endLog.lat).toBe(-41.1);
    expect(v.endLog.lng).toBe(174.6);
    expect(v.endLog.gpsSource).toBe("manual");
  });

  it("dates the return job by the departure's local day", () => {
    const v = buildReturnTrip({
      job,
      outboundEnd: undefined,
      homeBase,
      departAt: new Date("2026-09-14T13:00:00Z"), // 01:00 on the 15th in NZ
      arriveAt: new Date("2026-09-14T13:25:00Z"),
      timezone,
    });
    expect(v.job.jobDate).toBe("2026-09-15");
  });
});
