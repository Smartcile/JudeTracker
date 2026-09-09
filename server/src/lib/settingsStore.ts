import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { settings, type SettingsRow } from "../db/schema.ts";

const SETTINGS_ID = 1;

export async function getSettings(): Promise<SettingsRow | undefined> {
  return (await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)))[0];
}

export async function ensureSettings(): Promise<SettingsRow> {
  const existing = await getSettings();
  if (existing) return existing;
  await db.insert(settings).values({ id: SETTINGS_ID });
  return (await getSettings()) as SettingsRow;
}
