import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { config } from "../config.ts";
import { db } from "../db/index.ts";
import { sessions } from "../db/schema.ts";
import { HttpError } from "./http.ts";

export const SESSION_COOKIE = "jt_sid";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
  });
}

export async function createSession(res: Response): Promise<void> {
  const token = randomBytes(24).toString("hex");
  await db.insert(sessions).values({ tokenHash: sha256(token) });
  setSessionCookie(res, token);
}

/** Validates the request's session token, sliding the idle timer, and returns true if valid. */
export async function currentSession(req: Request): Promise<boolean> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const tokenHash = sha256(token);
  const row = (await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)))[0];
  if (!row) return false;
  const now = Date.now();
  if (now - row.createdAt.getTime() > config.sessionTtlMs || now - row.lastSeenAt.getTime() > config.idleMs) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return false;
  }
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.tokenHash, tokenHash));
  return true;
}

export async function deleteCurrentSession(req: Request): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!(await currentSession(req))) {
    next(new HttpError(401, "Not signed in"));
    return;
  }
  next();
}
