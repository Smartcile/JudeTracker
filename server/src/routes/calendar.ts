import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { calendarEvents } from "../db/schema.ts";
import { toCalEvent } from "../api/mappers.ts";
import { HttpError } from "../lib/http.ts";
import { listEvents, syncCalendar } from "../services/calendarSync.ts";

export const calendarRouter = Router();

calendarRouter.post("/sync", async (_req, res) => {
  const result = await syncCalendar();
  res.json({ ok: true, ...result });
});

calendarRouter.get("/upcoming", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 14), 1), 120);
  const from = new Date(Date.now() - 60 * 60 * 1000);
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const rows = await listEvents(from, to);
  res.json(rows.map(toCalEvent));
});

/** Events inside [from, to] — used by the calendar page (month view). uid narrows to one event. */
calendarRouter.get("/events", async (req, res) => {
  const uid = typeof req.query.uid === "string" && req.query.uid ? req.query.uid : null;
  const fromRaw = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
  if (uid) {
    const row = (await db.select().from(calendarEvents).where(eq(calendarEvents.uid, uid)))[0];
    res.json(row ? [toCalEvent(row)] : []);
    return;
  }
  const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = toRaw ? new Date(toRaw) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, "from/to must be valid dates");
  }
  const rows = await listEvents(from, to);
  res.json(rows.map(toCalEvent));
});
