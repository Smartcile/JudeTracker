import ical from "node-ical";

export interface RawCalendarEvent {
  uid: string;
  summary: string;
  location: string;
  description: string;
  startAt: Date | null;
  endAt: Date | null;
  allDay: boolean;
}

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "toJSDate" in v) {
    const d = (v as { toJSDate(): unknown }).toJSDate();
    return d instanceof Date ? d : null;
  }
  if (v instanceof Date) return v;
  return null;
}

export function parseIcs(text: string): RawCalendarEvent[] {
  const parsed = ical.parseICS(text);
  const out: RawCalendarEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== "VEVENT") continue;
    const start = asDate(ev.start);
    const allDay = (ev as { datetype?: string }).datetype === "date";
    out.push({
      uid: String(ev.uid ?? key ?? `ev-${out.length}`),
      summary: String(ev.summary ?? "").trim(),
      location: String(ev.location ?? "").trim(),
      description: String(ev.description ?? "").trim(),
      startAt: start,
      endAt: asDate(ev.end),
      allDay,
    });
  }
  return out;
}

export async function fetchCalendar(url: string): Promise<string> {
  const httpsUrl = url.replace(/^webcal:/i, "https:");
  const res = await fetch(httpsUrl, {
    headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "JudeTracker/0.1" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Calendar link returned HTTP ${res.status}`);
  return res.text();
}

export async function fetchAndParseCalendar(url: string): Promise<RawCalendarEvent[]> {
  return parseIcs(await fetchCalendar(url));
}
