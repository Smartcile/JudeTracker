import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { sessions, settings } from "../db/schema.ts";
import { toSettings } from "../api/mappers.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { hashPin, verifyPin } from "../lib/pin.ts";
import { changePinBody, settingsBody } from "../lib/validation.ts";
import { ensureSettings, getSettings } from "../lib/settingsStore.ts";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  res.json(toSettings(await ensureSettings()));
});

settingsRouter.put("/", async (req, res) => {
  const body = settingsBody.parse(req.body);
  const row = await ensureSettings();
  await db
    .update(settings)
    .set({
      timezone: body.timezone,
      calendarUrl: body.calendarUrl || null,
      calendarLabel: body.calendarLabel,
      syncError: null,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, row.id));
  const updated = await getSettings();
  httpAssert(updated, 500, "Settings missing");
  res.json(toSettings(updated));
});

settingsRouter.post("/pin", async (req, res) => {
  const { currentPin, newPin } = changePinBody.parse(req.body);
  const row = await getSettings();
  httpAssert(row?.pinHash != null, 409, "App not set up yet");
  if (!(await verifyPin(currentPin, row.pinHash))) throw new HttpError(401, "Current PIN is wrong");
  const updated = await db
    .update(settings)
    .set({ pinHash: await hashPin(newPin), updatedAt: new Date() })
    .where(eq(settings.id, row.id))
    .returning();
  httpAssert(updated[0], 404, "Settings not found");
  await db.delete(sessions);
  res.json({ ok: true });
});
