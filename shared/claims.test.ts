import { describe, expect, it } from "vitest";
import {
  analyzeUse,
  businessUsePct,
  computeClaim,
  formatKm,
  formatNzd,
  fyWindow,
  maxReadingForDigits,
  padReading,
  readingToWheels,
  tieredBlendedRateCents,
  toLocalDay,
  wheelsToReading,
} from "./claims.ts";
import type { LogDto } from "./types.ts";

describe("computeClaim", () => {
  it("computes km and cents from readings", () => {
    expect(computeClaim(87642, 87915, 95)).toEqual({ km: 273, amountCents: 25935 });
  });
  it("returns nulls when incomplete", () => {
    expect(computeClaim(null, 87915, 95)).toEqual({ km: null, amountCents: null });
    expect(computeClaim(87915, 87642, 95)).toEqual({ km: null, amountCents: null });
  });
  it("keeps km when only the rate is missing", () => {
    expect(computeClaim(87642, 87915, null)).toEqual({ km: 273, amountCents: null });
  });
});

describe("odometer helpers", () => {
  it("pads readings to the vehicle digit count", () => {
    expect(padReading(87642, 6)).toBe("087642");
    expect(padReading(999999, 6)).toBe("999999");
  });
  it("round trips wheels", () => {
    expect(wheelsToReading("123456".split(""))).toBe(123456);
  });
  it("splits a padded reading into one wheel digit each", () => {
    expect(readingToWheels(87642, 6)).toEqual(["0", "8", "7", "6", "4", "2"]);
    expect(readingToWheels(7, 3)).toEqual(["0", "0", "7"]);
  });
  it("caps readings at the odometer digit count", () => {
    expect(maxReadingForDigits(5)).toBe(99999);
    expect(maxReadingForDigits(6)).toBe(999999);
    expect(maxReadingForDigits(7)).toBe(9999999);
  });
});

describe("formatNzd", () => {
  it("formats cents as NZ dollars", () => {
    expect(formatNzd(25935)).toContain("259.35");
  });
});

describe("formatKm", () => {
  it("groups thousands with NZ separators", () => {
    expect(formatKm(0)).toBe("0");
    expect(formatKm(123456)).toBe("123,456");
  });
});

describe("toLocalDay", () => {
  it("returns YYYY-MM-DD in the target timezone", () => {
    const utc = new Date("2026-09-08T23:30:00Z");
    expect(toLocalDay(utc, "Pacific/Auckland")).toBe("2026-09-09");
    expect(toLocalDay(utc, "UTC")).toBe("2026-09-08");
  });
});

describe("tiered rates", () => {
  const cfg = { rateCents: 95, tierKm: 14000, tierRateCents: 63 };

  it("uses the first-tier rate entirely below the yearly limit", () => {
    expect(tieredBlendedRateCents(cfg, 10000, 200)).toBe(95);
    expect(tieredBlendedRateCents(cfg, 13800, 200)).toBe(95);
  });

  it("blends when a claim crosses the yearly limit", () => {
    const total = 50 * 95 + 150 * 63;
    expect(tieredBlendedRateCents(cfg, 13950, 200)).toBe(Math.round(total / 200));
  });

  it("uses the second rate once the limit is exhausted", () => {
    expect(tieredBlendedRateCents(cfg, 14000, 100)).toBe(63);
    expect(tieredBlendedRateCents(cfg, 30000, 100)).toBe(63);
  });

  it("returns null when not tiered", () => {
    expect(tieredBlendedRateCents({ rateCents: 95, tierKm: null, tierRateCents: null }, 0, 100)).toBeNull();
  });

  it("windows a NZ claim year (1 July - 30 June)", () => {
    expect(fyWindow("2026-09-09")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(fyWindow("2026-06-30")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(fyWindow("2026-07-01")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });
});

describe("personal-use baseline", () => {
  function log(id: number, vehicleId: number, readingKm: number, takenAt: string): LogDto {
    return {
      id,
      takenAt,
      lat: null,
      lng: null,
      accuracy: null,
      gpsSource: "none",
      readingKm,
      vehicleId,
      vehiclePlate: "P" + vehicleId,
      startJobId: null,
      endJobId: null,
      hasPhoto: true,
      createdAt: takenAt,
    };
  }
  const job = (id: number, startLog: LogDto | null, endLog: LogDto | null) => ({ id, startLog, endLog });

  it("counts gaps between different jobs as personal km", () => {
    const aStart = log(1, 1, 100000, "2026-09-09T09:00:00Z");
    const aEnd = log(2, 1, 100230, "2026-09-09T11:00:00Z");
    const bStart = log(3, 1, 100400, "2026-09-10T13:00:00Z");
    const bEnd = log(4, 1, 100520, "2026-09-10T15:00:00Z");
    const u = analyzeUse([job(10, aStart, aEnd), job(11, bStart, bEnd)]);
    expect(u.workKm).toBe(350); // 230 + 120
    expect(u.personalKm).toBe(170); // 100400 - 100230 (between trips)
    expect(u.totalKm).toBe(520);
    expect(businessUsePct(u)).toBe(67.3);
  });

  it("counts a zero gap as no personal km", () => {
    const aEnd = log(2, 1, 100230, "2026-09-09T11:00:00Z");
    const bStart = log(3, 1, 100230, "2026-09-09T11:05:00Z");
    const bEnd = log(4, 1, 100400, "2026-09-09T13:00:00Z");
    const u = analyzeUse([job(10, log(1, 1, 100000, "2026-09-09T09:00:00Z"), aEnd), job(11, bStart, bEnd)]);
    expect(u.personalKm).toBe(0);
    expect(u.workKm).toBe(400);
  });

  it("never mixes readings across vehicles", () => {
    const u = analyzeUse([
      job(10, log(1, 1, 100000, "2026-09-09T09:00:00Z"), log(2, 1, 100230, "2026-09-09T11:00:00Z")),
      job(11, log(3, 2, 50000, "2026-09-10T09:00:00Z"), log(4, 2, 50100, "2026-09-10T11:00:00Z")),
    ]);
    expect(u.workKm).toBe(330);
    expect(u.personalKm).toBe(0);
  });

  it("ignores jobs without both readings (they only act as boundaries)", () => {
    const aEnd = log(2, 1, 100230, "2026-09-09T11:00:00Z");
    const bStart = log(3, 1, 100400, "2026-09-10T09:00:00Z"); // no end log yet
    const u = analyzeUse([job(10, log(1, 1, 100000, "2026-09-09T09:00:00Z"), aEnd), job(11, bStart, null)]);
    expect(u.workKm).toBe(230);
    expect(u.personalKm).toBe(170);
    expect(businessUsePct(u)).toBe(57.5);
  });

  it("returns null percentage when nothing is logged", () => {
    expect(businessUsePct({ workKm: 0, personalKm: 0, totalKm: 0 })).toBeNull();
  });

  it("counts an explicit personal trip (tripKind personal) as personal km, not work", () => {
    const aStart = log(1, 1, 100000, "2026-09-09T09:00:00Z");
    const aEnd = log(2, 1, 100200, "2026-09-09T11:00:00Z");
    const pStart = log(3, 1, 100200, "2026-09-10T10:00:00Z");
    const pEnd = log(4, 1, 100300, "2026-09-10T12:00:00Z");
    const u = analyzeUse([
      { id: 10, startLog: aStart, endLog: aEnd },
      { id: 11, tripKind: "personal", startLog: pStart, endLog: pEnd },
    ]);
    expect(u.workKm).toBe(200);
    expect(u.personalKm).toBe(100);
    expect(businessUsePct(u)).toBe(66.7);
  });
});
