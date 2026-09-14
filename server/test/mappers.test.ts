import { describe, expect, it } from "vitest";
import { toCalEvent, toJob, toLog, toPlace, toSettings, toVehicle } from "../src/api/mappers.ts";
import type { CalendarEventRow, JobRow, LogRow, PlaceRow, SettingsRow, VehicleRow } from "../src/db/schema.ts";

const t = (iso: string) => new Date(iso);

function vehicleRow(partial: Partial<VehicleRow>): VehicleRow {
  return {
    id: 1,
    plate: "ABC123",
    make: "TOYOTA",
    model: "COROLLA",
    rateCents: 95,
    tierKm: null,
    tierRateCents: null,
    digits: 6,
    active: true,
    createdAt: t("2026-01-01T00:00:00Z"),
    updatedAt: t("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

function logRow(id: number, readingKm: number | null, partial: Partial<LogRow> = {}): LogRow {
  return {
    id,
    vehicleId: 1,
    takenAt: t(`2026-09-0${id}T0${id}:00:00Z`),
    lat: null,
    lng: null,
    accuracy: null,
    gpsSource: "none",
    readingKm,
    readingUpdatedAt: null,
    hasPhoto: true,
    createdAt: t("2026-09-01T00:00:00Z"),
    ...partial,
  };
}

function jobRow(partial: Partial<JobRow>): JobRow {
  return {
    id: 10,
    client: "ACME PLUMBING",
    location: "12 KOWHAI RD",
    locationLat: null,
    locationLng: null,
    notes: "",
    jobDate: "2026-09-09",
    eventUid: null,
    tripKind: "business",
    status: "ready",
    vehicleId: 1,
    startLogId: 1,
    endLogId: 2,
    returnLogId: null,
    rateCents: null,
    claimedAt: null,
    submittedAt: null,
    paidAt: null,
    createdAt: t("2026-09-08T00:00:00Z"),
    updatedAt: t("2026-09-08T00:00:00Z"),
    ...partial,
  };
}

describe("toVehicle", () => {
  it("maps rate and tier fields", () => {
    const v = toVehicle(vehicleRow({ rateCents: 95, tierKm: 14000, tierRateCents: 63 }));
    expect(v.rateCents).toBe(95);
    expect(v.tierKm).toBe(14000);
    expect(v.tierRateCents).toBe(63);
    expect(v.digits).toBe(6);
  });
});

describe("toLog", () => {
  it("includes the hasPhoto flag and a resolved plate", () => {
    const log = toLog(logRow(1, 100000), new Map([[1, "ABC123"]]));
    expect(log.hasPhoto).toBe(true);
    expect(log.vehiclePlate).toBe("ABC123");
    expect(log.readingKm).toBe(100000);
  });
});

describe("toJob", () => {
  const vehicle = vehicleRow({});
  const plateMap = new Map([[1, "ABC123"]]);

  it("computes km and amount for a business trip", () => {
    const dto = toJob({ job: jobRow({}), vehicle, startLog: logRow(1, 100000), endLog: logRow(2, 100230), logPlates: plateMap });
    expect(dto.tripKind).toBe("business");
    expect(dto.km).toBe(230);
    expect(dto.effectiveRateCents).toBe(95);
    expect(dto.amountCents).toBe(21850);
  });

  it("uses the claim snapshot rate once lodged", () => {
    const dto = toJob({
      job: jobRow({ status: "claimed", rateCents: 63, claimedAt: t("2026-09-10T00:00:00Z") }),
      vehicle: vehicleRow({ rateCents: 95 }),
      startLog: logRow(1, 100000),
      endLog: logRow(2, 100230),
      logPlates: plateMap,
    });
    expect(dto.effectiveRateCents).toBe(63);
    expect(dto.amountCents).toBe(230 * 63);
  });

  it("keeps km but no money for personal trips", () => {
    const dto = toJob({
      job: jobRow({ tripKind: "personal", client: "PERSONAL ERRAND", eventUid: null }),
      vehicle: vehicleRow({ rateCents: 95 }),
      startLog: logRow(1, 100000),
      endLog: logRow(2, 100100),
      logPlates: plateMap,
    });
    expect(dto.tripKind).toBe("personal");
    expect(dto.km).toBe(100);
    expect(dto.effectiveRateCents).toBeNull();
    expect(dto.amountCents).toBeNull();
  });

  it("returns nulls before readings exist", () => {
    const dto = toJob({ job: jobRow({}), vehicle, logPlates: plateMap });
    expect(dto.km).toBeNull();
    expect(dto.amountCents).toBeNull();
  });

  it("uses the return reading as the trip end when a return leg exists", () => {
    const dto = toJob({
      job: jobRow({ returnLogId: 3 }),
      vehicle,
      startLog: logRow(1, 100000),
      endLog: logRow(2, 100230),
      returnLog: logRow(3, 100260),
      logPlates: plateMap,
    });
    expect(dto.km).toBe(260);
    expect(dto.amountCents).toBe(260 * 95);
    expect(dto.returnLog?.readingKm).toBe(100260);
  });

  it("keeps a trip with an unread return leg incomplete", () => {
    const dto = toJob({
      job: jobRow({ returnLogId: 3 }),
      vehicle,
      startLog: logRow(1, 100000),
      endLog: logRow(2, 100230),
      returnLog: logRow(3, null),
      logPlates: plateMap,
    });
    expect(dto.km).toBeNull();
    expect(dto.amountCents).toBeNull();
  });
});

describe("toPlace", () => {
  it("maps a saved place", () => {
    const row: PlaceRow = {
      id: 7,
      name: "Sarah's place",
      address: "12 Kowhai Rd, Wellington",
      lat: -41.28,
      lng: 174.77,
      createdAt: t("2026-01-01T00:00:00Z"),
      updatedAt: t("2026-01-01T00:00:00Z"),
    };
    const p = toPlace(row);
    expect(p).toEqual({ id: 7, name: "Sarah's place", address: "12 Kowhai Rd, Wellington", lat: -41.28, lng: 174.77 });
  });
});

describe("toSettings", () => {
  it("maps the home base fields", () => {
    const row: SettingsRow = {
      id: 1,
      pinHash: null,
      timezone: "Pacific/Auckland",
      calendarUrl: null,
      calendarLabel: "Client calendar",
      homeBaseAddress: "1 Home Rd",
      homeBaseLat: -41.1,
      homeBaseLng: 174.6,
      lastSyncAt: null,
      syncError: null,
      createdAt: t("2026-01-01T00:00:00Z"),
      updatedAt: t("2026-01-01T00:00:00Z"),
    };
    const s = toSettings(row);
    expect(s.homeBaseAddress).toBe("1 Home Rd");
    expect(s.homeBaseLat).toBe(-41.1);
    expect(s.homeBaseLng).toBe(174.6);
    expect(s.pinSet).toBe(false);
  });
});

describe("toCalEvent", () => {
  it("maps all-day events without a time shift", () => {
    const row: CalendarEventRow = {
      id: 5,
      uid: "EVENT-1",
      summary: "ACME",
      location: "WELLINGTON",
      description: "",
      startAt: t("2026-09-15T10:00:00Z"),
      endAt: null,
      allDay: false,
      createdAt: t("2026-09-01T00:00:00Z"),
    };
    const ev = toCalEvent(row);
    expect(ev.uid).toBe("EVENT-1");
    expect(ev.allDay).toBe(false);
    expect(ev.startAt).toBe("2026-09-15T10:00:00.000Z");
    expect(ev.endAt).toBeNull();
  });
});
