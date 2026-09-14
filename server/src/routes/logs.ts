import { Router } from "express";
import { eq, inArray, or } from "drizzle-orm";
import multer from "multer";
import { toLocalDay } from "../../../shared/claims.ts";
import { toJob, toLog } from "../api/mappers.ts";
import { config } from "../config.ts";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles } from "../db/schema.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { ensureSettings } from "../lib/settingsStore.ts";
import { logFields, logPatchBody, readingBody } from "../lib/validation.ts";
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

const LOG_ROLES = ["start", "end", "return"] as const;
export type LogRole = (typeof LOG_ROLES)[number];
const LOG_RANK: Record<LogRole, number> = { start: 0, end: 1, return: 2 };

/** Attach log to a job slot, enforcing vehicle + time + reading consistency. */
async function attachLog(jobId: number, logId: number, role: LogRole): Promise<void> {
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

  const slotIds: Record<LogRole, number | null> = {
    start: jobRow.startLogId,
    end: jobRow.endLogId,
    return: jobRow.returnLogId,
  };
  if (slotIds[role] != null) {
    throw new HttpError(
      409,
      `This job already has ${role === "start" ? "a start photo" : role === "end" ? "an end photo" : "a return reading"}`,
    );
  }

  for (const other of LOG_ROLES) {
    const otherId = slotIds[other];
    if (otherId == null) continue;
    const row = await requireLog(otherId);
    if (row.vehicleId != null && row.vehicleId !== vehicleId) {
      throw new HttpError(409, "Start, end and return logs must be of the same vehicle");
    }
    const before = LOG_RANK[other] < LOG_RANK[role];
    const timeOk = before
      ? row.takenAt.getTime() <= log.takenAt.getTime()
      : row.takenAt.getTime() >= log.takenAt.getTime();
    if (!timeOk) {
      throw new HttpError(409, "Logs must run in order: start, then end, then return");
    }
    if (row.readingKm != null && log.readingKm != null) {
      const readingOk = before ? log.readingKm >= row.readingKm : log.readingKm <= row.readingKm;
      if (!readingOk) {
        throw new HttpError(409, "Readings must not go backwards within a job");
      }
    }
  }

  if (role === "start") {
    const settings = await ensureSettings();
    await db
      .update(jobs)
      .set({
        startLogId: logId,
        jobDate: toLocalDay(log.takenAt, settings.timezone),
        ...(jobRow.vehicleId == null ? { vehicleId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    return;
  }
  await db
    .update(jobs)
    .set({
      [role === "end" ? "endLogId" : "returnLogId"]: logId,
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
      locationLabel: fields.locationLabel,
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
      .where(or(eq(jobs.startLogId, id), eq(jobs.endLogId, id), eq(jobs.returnLogId, id)))
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

logsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = logPatchBody.parse(req.body);
  await requireLog(id);
  const updates: Record<string, unknown> = {};

  const job = (
    await db
      .select()
      .from(jobs)
      .where(or(eq(jobs.startLogId, id), eq(jobs.endLogId, id), eq(jobs.returnLogId, id)))
  )[0];
  if (job && (job.status === "claimed" || job.status === "submitted" || job.status === "paid")) {
    throw new HttpError(409, "Claim already lodged - reopen it first to make changes");
  }

  if (body.takenAt !== undefined) {
    const takenAt = new Date(body.takenAt);
    if (job) {
      const chain: Array<[LogRole, number | null]> = [
        ["start", job.startLogId],
        ["end", job.endLogId],
        ["return", job.returnLogId],
      ];
      const mine = chain.find(([, logId]) => logId === id)?.[0] ?? null;
      if (mine) {
        for (const [otherRole, otherId] of chain) {
          if (otherId == null || otherId === id) continue;
          const other = await requireLog(otherId);
          const before = LOG_RANK[otherRole] < LOG_RANK[mine];
          const ok = before
            ? takenAt.getTime() >= other.takenAt.getTime()
            : takenAt.getTime() <= other.takenAt.getTime();
          httpAssert(ok, 409, "Logs must run in order: start, then end, then return");
        }
      }
    }
    updates.takenAt = takenAt;
    if (job && job.startLogId === id) {
      const settings = await ensureSettings();
      await db.update(jobs).set({ jobDate: toLocalDay(takenAt, settings.timezone), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    }
  }

  if (body.lat !== undefined) {
    const hasCoords = body.lat != null;
    updates.lat = hasCoords ? body.lat : null;
    updates.lng = hasCoords ? body.lng : null;
    updates.locationLabel = hasCoords ? body.locationLabel ?? "" : "";
    updates.accuracy = null;
    updates.gpsSource = hasCoords ? "manual" : "none";
  } else if (body.locationLabel !== undefined) {
    updates.locationLabel = body.locationLabel;
  }

  httpAssert(Object.keys(updates).length > 0, 400, "Nothing to update");
  const updated = await db
    .update(logs)
    .set(updates)
    .where(eq(logs.id, id))
    .returning();
  httpAssert(updated[0], 500, "Failed to update log");
  const pm = await plateMapOfVehicleIds([updated[0].vehicleId]);
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
  await db.update(jobs).set({ returnLogId: null }).where(eq(jobs.returnLogId, id));
  await db.delete(logs).where(eq(logs.id, id));
  await removePhoto(id);
  res.json({ ok: true });
});
