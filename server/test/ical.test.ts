import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/services/ical.ts";

const fixture = readFileSync(path.join(__dirname, "fixtures", "icloud.ics"), "utf8");

describe("parseIcs", () => {
  it("parses events with timezone-aware start times (NZDT +13)", () => {
    const events = parseIcs(fixture);
    expect(events).toHaveLength(2);

    const wof = events.find((e) => e.uid.startsWith("8E38C732"))!;
    expect(wof.summary).toBe("Acme Plumbing - WOF check");
    expect(wof.location).toBe("12 Kowhai Rd, Papakura");
    expect(wof.description).toBe("Booked by Anne");
    expect(wof.allDay).toBe(false);
    // 2026-09-15 is NZST (DST starts last Sunday of September) => 10:00 NZST == 22:00Z
    expect(wof.startAt!.toISOString()).toBe("2026-09-14T22:00:00.000Z");
    expect(wof.endAt!.toISOString()).toBe("2026-09-14T23:30:00.000Z");
  });

  it("marks all-day events and keeps their date", () => {
    const allDay = parseIcs(fixture).find((e) => e.uid.startsWith("4D6A9821"))!;
    expect(allDay.allDay).toBe(true);
    expect(allDay.summary).toBe("Full day at North Shore site");
  });
});
