import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { settings } from "../db/schema.ts";
import { hashPin, verifyPin } from "../lib/pin.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { loginBody, setupBody } from "../lib/validation.ts";
import {
  clearSessionCookie,
  createSession,
  currentSession,
  deleteCurrentSession,
} from "../lib/auth.ts";
import { ensureSettings, getSettings } from "../lib/settingsStore.ts";

export const authRouter = Router();

authRouter.get("/state", async (_req, res) => {
  const row = await getSettings();
  const authed = await currentSession(_req);
  res.json({ authed, needsSetup: !row || row.pinHash == null });
});

authRouter.post("/setup", async (req, res) => {
  const { pin } = setupBody.parse(req.body);
  const row = await ensureSettings();
  httpAssert(row.pinHash == null, 409, "PIN already set up");
  await db.update(settings).set({ pinHash: await hashPin(pin) }).where(eq(settings.id, row.id));
  await createSession(res);
  res.json({ ok: true });
});

authRouter.post("/login", async (req, res) => {
  const { pin } = loginBody.parse(req.body);
  const row = await getSettings();
  httpAssert(row?.pinHash != null, 409, "App not set up yet");
  if (!(await verifyPin(pin, row.pinHash))) throw new HttpError(401, "Wrong PIN");
  await createSession(res);
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  await deleteCurrentSession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});
