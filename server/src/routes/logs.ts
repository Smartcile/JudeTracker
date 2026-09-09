import { Router } from "express";
import { eq, inArray, or } from "drizzle-orm";
import multer from "multer";
import { toJob, toLog } from "../api/mappers.ts";
import { config } from "../config.ts";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles } from "../db/schema.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { logFields, readingBody } from "../lib/validation.ts";
import { readingContext, setLogReading } from "../services/readings.ts";
import { removePhoto, storePhoto } from "../services/photos.ts";
import { readPhotoMeta } from "../services/exif.ts";
import { assertJobLocked, requireJob } from "./jobs.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

export const jobsLogsRouter = Router(); // mounted at /api - handles /jobs/:id/logs
export const logsRouter = Router(); // mounted at /api/logs

async function requireLog(id: number) {
  const row = (await db.select().from(logs).where(eq(logs.id, id)))[0];
  if (!row) throw new HttpError(404, "Log not found");
  return row;
}

async function plateMapOfVehicleIds(vehicleIds: Array<number | null>): Promise<Map<number, string>> {
  const uniq = [...new Set(vehicleIds.filter((x): x is number => x != null))];
  if (uniq.length === 0) return new Map();
  const rows = await db
    .select({ id: vehicles.id, plate: vehicles.plate })
    .from(vehicles)
    .where(inArray(vehicles.id, uniq));
  return new Map(rows.map((r) => [r.id, r.plate]));
}

/** Attach log to a job slot, enforcing vehicle + time + reading consistency. */
async function attachLog(jobId: number, logId: number, role: "start" | "end"): Promise<void> {
  const job = await requireJob(jobId);
  const log = await requireLog(logId);
  const jobRow = job.job;

  await assertJobLocked(jobRow);

  if (jobRow.vehicleId != null && log.vehicleId != null && jobRow.vehicleId !== log.vehicleId) {
    throw new HttpError(409, `This job uses ${job.vehicle?.plate}, but the photo is for a different vehicle`);
  }
  if (jobRow.vehicleId == null && log.vehicleId == null) {
    throw new HttpError(409, "Pick a vehicle for this job's photos first");
  }
  const vehicleId = jobRow.vehicleId ?? log.vehicleId;

  const otherId = role === "start" ? jobRow.endLogId : jobRow.startLogId;
  const other = otherId != null ? await requireLog(otherId) : undefined;
  if (other) {
    if (other.vehicleId != null && other.vehicleId !== vehicleId) {
      throw new HttpError(409, "Start and end photos must be of the same vehicle");
    }
    const timeOk =
      (role === "start" && log.takenAt.getTime() <= other.takenAt.getTime()) ||
      (role === "end" && log.takenAt.getTime() >= other.takenAt.getTime());
    if (!timeOk) {
      throw new HttpError(409, "The start photo must be taken before the end photo");
    }
    const mine = log.readingKm;
    const theirs = other.readingKm;
    if (mine != null && theirs != null) {
      if ((role === "start" && mine > theirs) || (role === "end" && mine < theirs)) {
        throw new HttpError(409, "Readings must not go backwards within a job");
      }
    }
  }

  const slotTaken = role === "start" ? jobRow.startLogId != null : jobRow.endLogId != null;
  if (slotTaken) {
    throw new HttpError(409, `This job already has ${role === "start" ? "a start" : "an end"} photo`);
  }

  await db
    .update(jobs)
    .set({
      ...(role === "start" ? { startLogId: logId } : { endLogId: logId }),
      ...(jobRow.vehicleId == null ? { vehicleId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

jobsLogsRouter.post("/jobs/:id/logs", upload.single("photo"), async (req, res) => {
  const jobId = Number(req.params.id);
  const fields = logFields.parse(req.body ?? {});
  const job = await requireJob(jobId);
  await assertJobLocked(job.job);

  const vehicleId = fields.vehicleId ?? job.job.vehicleId;
  httpAssert(vehicleId != null, 400, "Pick a vehicle for this log");
  const vehicle = (await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0];
  httpAssert(vehicle, 400, "Vehicle not found");
  if (job.job.vehicleId != null && job.job.vehicleId !== vehicleId) {
    throw new HttpError(409, `This job uses ${job.vehicle?.plate} - pick that vehicle`);
  }

  let takenAt = fields.takenAt ? new Date(fields.takenAt) : null;
  if (takenAt && Number.isNaN(takenAt.getTime())) takenAt = null;

  let lat = fields.lat ?? null;
  let lng = fields.lng ?? null;
  let gpsSource = fields.gpsSource ?? "none";
  const accuracy = fields.accuracy ?? null;

  // EXIF fallback only exists when a photo is actually uploaded.
  if (req.file) {
    const meta = await readPhotoMeta(req.file.buffer);
    if (!takenAt && meta.takenAt) takenAt = meta.takenAt;
    if ((lat == null || lng == null) && meta.lat != null && meta.lng != null) {
      lat = meta.lat;
      lng = meta.lng;
      if (gpsSource === "none") gpsSource = "exif";
    }
  }
  takenAt = takenAt ?? new Date();

  const inserted = await db
    .insert(logs)
    .values({
      vehicleId,
      takenAt,
      lat: lat ?? null,
      lng: lng ?? null,
      accuracy,
      gpsSource,
      hasPhoto: req.file != null,
    })
    .returning();
  const log = inserted[0];
  httpAssert(log, 500, "Failed to insert log");

  try {
    if (req.file) {
      await storePhoto(log.id, req.file.buffer);
    }
    if (fields.role) await attachLog(jobId, log.id, fields.role);
  } catch (err) {
    await db.delete(logs).where(eq(logs.id, log.id));
    await removePhoto(log.id);
    throw err;
  }

  res.status(201).json(toJob(await requireJob(jobId)));
});

logsRouter.put("/:id/reading", async (req, res) => {
  const id = Number(req.params.id);
  const { readingKm } = readingBody.parse(req.body);
  await setLogReading(id, readingKm);
  const ctx = await readingContext(id);
  httpAssert(ctx, 404, "Log not found");
  const log = await requireLog(id);
  const pm = await plateMapOfVehicleIds([log.vehicleId]);
  res.json({ log: toLog(log, pm), floorKm: ctx.floorKm, prevReadingKm: ctx.prevReadingKm });
});

/** Attach a photo to a manual ("Later on") log that was saved without one. */
logsRouter.put("/:id/photo", upload.single("photo"), async (req, res) => {
  const id = Number(req.params.id);
  const log = await requireLog(id);
  httpAssert(req.file, 400, "Photo file is required (form field 'photo')");
  httpAssert(!log.hasPhoto, 409, "This log already has a photo");

  const job = (
    await db
      .select()
      .from(jobs)
      .where(or(eq(jobs.startLogId, id), eq(jobs.endLogId, id)))
  )[0];
  if (job && (job.status === "claimed" || job.status === "submitted" || job.status === "paid")) {
    throw new HttpError(409, "Claim already lodged - reopen it first to make changes");
  }

  // Backfill GPS from the photo when the manual log has no coordinates yet.
  let lat = log.lat;
  let lng = log.lng;
  let gpsSource = log.gpsSource;
  const meta = await readPhotoMeta(req.file.buffer);
  if (lat == null && lng == null && meta.lat != null && meta.lng != null) {
    lat = meta.lat;
    lng = meta.lng;
    gpsSource = "exif";
  }

  await storePhoto(id, req.file.buffer);
  const updated = await db
    .update(logs)
    .set({ hasPhoto: true, lat, lng, gpsSource })
    .where(eq(logs.id, id))
    .returning();
  httpAssert(updated[0], 500, "Failed to update log");
  const pm = await plateMapOfVehicleIds([log.vehicleId]);
  res.json({ ok: true, log: toLog(updated[0], pm) });
});

logsRouter.get("/:id/reading-info", async (req, res) => {
  const id = Number(req.params.id);
  const ctx = await readingContext(id);
  httpAssert(ctx, 404, "Log not found");
  const log = await requireLog(id);
  const pm = await plateMapOfVehicleIds([log.vehicleId]);
  res.json({
    log: toLog(log, pm),
    jobId: ctx.jobId,
    jobStatus: ctx.jobStatus,
    role: ctx.role,
    vehicleDigits: ctx.vehicleDigits,
    floorKm: ctx.floorKm,
    capKm: ctx.capKm,
    prevReadingKm: ctx.prevReadingKm,
    canEdit: ctx.canEdit,
  });
});

logsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await requireLog(id);
  await db.update(jobs).set({ startLogId: null }).where(eq(jobs.startLogId, id));
  await db.update(jobs).set({ endLogId: null }).where(eq(jobs.endLogId, id));
  await db.delete(logs).where(eq(logs.id, id));
  await removePhoto(id);
  res.json({ ok: true });
});
