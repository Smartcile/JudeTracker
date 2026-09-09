import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { calendarEvents, jobs, settings } from "../db/schema.ts";
import { getSettings } from "../lib/settingsStore.ts";
import { fetchAndParseCalendar, type RawCalendarEvent } from "./ical.ts";

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export async function syncCalendar(): Promise<SyncResult> {
  const cfg = await getSettings();
  if (!cfg?.calendarUrl) throw new Error("No calendar link configured");

  let events: RawCalendarEvent[];
  try {
    events = await fetchAndParseCalendar(cfg.calendarUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(settings).set({ syncError: message }).where(eq(settings.id, cfg.id));
    throw new Error(`Calendar sync failed: ${message}`);
  }

  let added = 0;
  let updated = 0;
  for (const ev of events) {
    const values = {
      summary: clip(ev.summary, 300),
      location: clip(ev.location, 300),
      description: clip(ev.description, 2000),
      startAt: ev.startAt,
      endAt: ev.endAt,
      allDay: ev.allDay,
    };
    const existing = (await db.select({ id: calendarEvents.id }).from(calendarEvents).where(eq(calendarEvents.uid, ev.uid)))[0];
    if (existing) {
      await db.update(calendarEvents).set(values).where(eq(calendarEvents.uid, ev.uid));
      updated++;
    } else {
      await db.insert(calendarEvents).values({ uid: ev.uid, ...values });
      added++;
    }
  }

  // Prune events that vanished from the feed - unless a job still references
  // them (kept so linked trips survive calendar edits).
  const removed = await pruneMissingEvents(events.map((e) => e.uid));

  await db.update(settings).set({ lastSyncAt: new Date(), syncError: null }).where(eq(settings.id, cfg.id));
  return { added, updated, removed, total: events.length };
}

/** Delete stored events whose uid is gone from the feed and not attached to any job. */
async function pruneMissingEvents(feedUids: string[]): Promise<number> {
  const referenced = (
    await db
      .select({ uid: jobs.eventUid })
      .from(jobs)
  )
    .map((r) => r.uid)
    .filter((u): u is string => u != null);

  const keepUids = [...new Set([...feedUids, ...referenced])];

  let deleted: Array<{ id: number }>;
  if (keepUids.length === 0) {
    deleted = await db.delete(calendarEvents).returning({ id: calendarEvents.id });
  } else {
    deleted = await db
      .delete(calendarEvents)
      .where(notInArray(calendarEvents.uid, keepUids))
      .returning({ id: calendarEvents.id });
  }
  return deleted.length;
}

/** Poll the feed periodically if a URL is configured. */
export async function maybeAutoSync(): Promise<void> {
  const cfg = await getSettings();
  if (!cfg?.calendarUrl) return;
  const last = cfg.lastSyncAt;
  if (last && Date.now() - last.getTime() < 15 * 60_000) return;
  try {
    await syncCalendar();
  } catch {
    // Keep the app running; sync errors surface in settings.
  }
}

/** Calendar events starting within [from, to], soonest first. */
export async function listEvents(from: Date, to: Date): Promise<Array<typeof calendarEvents.$inferSelect>> {
  return db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.startAt, from), lte(calendarEvents.startAt, to)))
    .orderBy(calendarEvents.startAt);
}
