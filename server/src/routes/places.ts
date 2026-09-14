import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { toPlace } from "../api/mappers.ts";
import { db } from "../db/index.ts";
import { places } from "../db/schema.ts";
import { httpAssert } from "../lib/http.ts";
import { placeBody } from "../lib/validation.ts";

export const placesRouter = Router();

placesRouter.get("/", async (_req, res) => {
  res.json((await db.select().from(places).orderBy(asc(places.name), asc(places.id))).map(toPlace));
});

placesRouter.post("/", async (req, res) => {
  const body = placeBody.parse(req.body);
  const rows = await db.insert(places).values(body).returning();
  const created = rows[0];
  httpAssert(created, 500, "Failed to save the place");
  res.status(201).json(toPlace(created));
});

placesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = placeBody.parse(req.body);
  const rows = await db
    .update(places)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(places.id, id))
    .returning();
  const updated = rows[0];
  httpAssert(updated, 404, "Place not found");
  res.json(toPlace(updated));
});

placesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(places).where(eq(places.id, id));
  res.json({ ok: true });
});
