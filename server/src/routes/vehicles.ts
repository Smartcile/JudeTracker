import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles } from "../db/schema.ts";
import { toVehicle } from "../api/mappers.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { vehicleBody } from "../lib/validation.ts";

export const vehiclesRouter = Router();

vehiclesRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(vehicles).orderBy(vehicles.plate);
  res.json(rows.map(toVehicle));
});

vehiclesRouter.post("/", async (req, res) => {
  const v = vehicleBody.parse(req.body);
  const dup = (await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.plate, v.plate)))[0];
  httpAssert(!dup, 409, `A vehicle with plate ${v.plate} already exists`);
  const inserted = await db.insert(vehicles).values(v).returning();
  httpAssert(inserted[0], 500, "Failed to create vehicle");
  res.status(201).json(toVehicle(inserted[0]));
});

vehiclesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const v = vehicleBody.parse(req.body);
  const [row] = await db
    .update(vehicles)
    .set({ ...v, updatedAt: new Date() })
    .where(eq(vehicles.id, id))
    .returning();
  httpAssert(row, 404, "Vehicle not found");
  res.json(toVehicle(row));
});

vehiclesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const inUse =
    (await db.select({ id: logs.id }).from(logs).where(eq(logs.vehicleId, id)).limit(1))[0] ??
    (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.vehicleId, id)).limit(1))[0];
  httpAssert(!inUse, 409, "Vehicle still has logs or jobs attached");
  const deleted = await db.delete(vehicles).where(sql`${vehicles.id} = ${id}`).returning();
  httpAssert(deleted[0], 404, "Vehicle not found");
  res.json({ ok: true });
});
