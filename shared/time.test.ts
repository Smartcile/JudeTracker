import { describe, expect, it } from "vitest";
import { minutesBetween, shiftIsoMinutes } from "./time.ts";

describe("shiftIsoMinutes", () => {
  it("moves an instant backwards by whole minutes", () => {
    expect(shiftIsoMinutes("2026-09-14T09:00:00.000Z", -25)).toBe("2026-09-14T08:35:00.000Z");
  });

  it("moves an instant forwards by whole minutes", () => {
    expect(shiftIsoMinutes("2026-09-14T09:00:00.000Z", 30)).toBe("2026-09-14T09:30:00.000Z");
  });

  it("crosses midnight", () => {
    expect(shiftIsoMinutes("2026-09-14T00:10:00.000Z", -20)).toBe("2026-09-13T23:50:00.000Z");
  });

  it("returns the same instant for zero", () => {
    expect(shiftIsoMinutes("2026-09-14T09:00:00.000Z", 0)).toBe("2026-09-14T09:00:00.000Z");
  });
});

describe("minutesBetween", () => {
  it("returns positive minutes for a later second instant", () => {
    expect(minutesBetween("2026-09-14T08:35:00.000Z", "2026-09-14T09:00:00.000Z")).toBe(25);
  });

  it("returns negative minutes when the second instant is earlier", () => {
    expect(minutesBetween("2026-09-14T09:00:00.000Z", "2026-09-14T08:35:00.000Z")).toBe(-25);
  });
});
