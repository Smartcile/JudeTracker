import { Router } from "express";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { toLocalDay } from "../../../shared/claims.ts";
import { toJob, type JobAssembled } from "../api/mappers.ts";
import { db } from "../db/index.ts";
import { calendarEvents, jobs, logs, vehicles } from "../db/schema.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { buildNextTrip, buildReturnLog } from "../lib/tripLegs.ts";
import { ensureSettings } from "../lib/settingsStore.ts";
import { jobCreateBody, jobPatchBody, returnLogBody } from "../lib/validation.ts";
import { loadJob, loadJobs } from "../services/jobs.ts";
import { removePhoto } from "../services/photos.ts";
import { setLogReading } from "../services/readings.ts";

export const jobsRouter = Router();

export async function requireJob(id: number): Promise<JobAssembled> {
  const job = await loadJob(id);
  if (!job) throw new HttpError(404, "Job not found");
  return job;
}

export async function assertJobLocked(job: { status: string }): Promise<void> {
  httpAssert(
    job.status !== "claimed" && job.status !== "submitted" && job.status !== "paid",
    409,
    "Claim already lodged - reopen it first to make changes",
  );
}

jobsRouter.get("/", async (_req, res) => {
  res.json((await loadJobs()).map(toJob));
});

jobsRouter.post("/", async (req, res) => {
  const body = jobCreateBody.parse(req.body);
  const row = await ensureSettings();
  let client = body.client?.trim() ?? "";
  let location = body.location?.trim() ?? "";
  let jobDate = body.jobDate;

  if (body.eventUid) {
    const ev = (await db.select().from(calendarEvents).where(eq(calendarEvents.uid, body.eventUid)))[0];
    httpAssert(ev, 404, "Calendar event not found");
    if (!client) client = ev.summary || "Client";
    if (!location) location = ev.location;
    if (!jobDate && ev.startAt) jobDate = toLocalDay(ev.startAt, row.timezone);
  }
  if (!jobDate) jobDate = toLocalDay(new Date(), row.timezone);
  if (!client) {
    // Unnamed manual job - the name can be filled in later from the trip popup.
    client = body.kind === "personal" ? "PERSONAL TRIP — DETAILS LATER" : "BUSINESS TRIP — DETAILS LATER";
  }

  const inserted = await db
    .insert(jobs)
    .values({
      client,
      location,
      locationLat: body.locationLat ?? null,
      locationLng: body.locationLng ?? null,
      notes: body.notes ?? "",
      jobDate,
      eventUid: body.eventUid ?? null,
      tripKind: body.kind,
    })
    .returning();
  const created = inserted[0];
  httpAssert(created, 500, "Failed to create job");
  res.status(201).json(toJob(await requireJob(created.id)));
});

jobsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = jobPatchBody.parse(req.body);
  const job = await requireJob(id);
  const hasBodyFields =
    body.client !== undefined ||
    body.location !== undefined ||
    body.locationLat !== undefined ||
    body.locationLng !== undefined ||
    body.notes !== undefined ||
    body.eventUid !== undefined ||
    body.jobDate !== undefined ||
    body.vehicleId !== undefined;
  httpAssert(hasBodyFields, 400, "Nothing to update");
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.client !== undefined) updates.client = body.client;
  if (body.location !== undefined) updates.location = body.location;
  if (body.locationLat !== undefined || body.locationLng !== undefined) {
    updates.locationLat = body.locationLat ?? null;
    updates.locationLng = body.locationLng ?? null;
  } else if (body.location !== undefined) {
    // Address edited without a picked point — drop any stale coordinates.
    updates.locationLat = null;
    updates.locationLng = null;
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.jobDate !== undefined) updates.jobDate = body.jobDate;
  if (body.eventUid !== undefined) {
    if (body.eventUid !== null) {
      const ev = (await db.select().from(calendarEvents).where(eq(calendarEvents.uid, body.eventUid)))[0];
      httpAssert(ev, 404, "Calendar event not found");
    }
    updates.eventUid = body.eventUid;
  }
  if (body.vehicleId !== undefined) {
    await assertJobLocked(job.job);
    const logIds = [job.job.startLogId, job.job.endLogId, job.job.returnLogId].filter((x): x is number => x != null);
    if (body.vehicleId === null) {
      httpAssert(logIds.length === 0, 409, "Attached photos keep this trip on a car - delete them first to unassign");
    } else {
      const target = (await db.select().from(vehicles).where(eq(vehicles.id, body.vehicleId)))[0];
      httpAssert(target, 400, "Vehicle not found");
      for (const [role, log] of [["start", job.startLog], ["end", job.endLog], ["return", job.returnLog]] as const) {
        if (log?.readingKm != null) {
          httpAssert(
            false,
            409,
            `A reading is already entered on the ${role} log - it pins this trip to ${job.vehicle?.plate ?? "its current car"}. Delete the reading's log photo to change cars.`,
          );
        }
      }
      if (logIds.length > 0) {
        const clash = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              ne(jobs.id, id),
              eq(jobs.vehicleId, body.vehicleId),
              or(
                inArray(jobs.startLogId, logIds),
                inArray(jobs.endLogId, logIds),
                inArray(jobs.returnLogId, logIds),
              ),
            ),
          )
          .limit(1);
        httpAssert(clash.length === 0, 409, "Another trip shares one of this trip's photos on that car");
        await db.update(logs).set({ vehicleId: body.vehicleId }).where(inArray(logs.id, logIds));
      }
    }
    updates.vehicleId = body.vehicleId;
  }
  await db
    .update(jobs)
    .set(updates)
    .where(eq(jobs.id, id));
  res.json(toJob(await requireJob(id)));
});


/** Adds the drive home as this trip's return (home arrival) reading — a manual log, no photo. */
jobsRouter.post("/:id/return-log", async (req, res) => {
  const id = Number(req.params.id);
  const { arriveAt, distanceKm } = returnLogBody.parse(req.body);
  const job = await requireJob(id);
  await assertJobLocked(job.job);
  httpAssert(job.job.vehicleId != null, 409, "Pick a car for this trip first");
  const endLog = job.endLog;
  httpAssert(endLog, 409, "Log the client arrival (end) before the drive home");
  httpAssert(job.job.returnLogId == null, 409, "This trip already has a return reading");
  const arrive = new Date(arriveAt);
  httpAssert(arrive.getTime() >= endLog.takenAt.getTime(), 409, "The drive home must arrive after the client arrival");
  const settings = await ensureSettings();
  httpAssert(settings.homeBaseLat != null && settings.homeBaseLng != null, 400, "Set a home base in Settings first");

  const baseKm = endLog.readingKm;
  const distance = distanceKm ?? null;
  if (distance != null) {
    httpAssert(baseKm != null, 409, "Enter the client reading first so the distance can set the odometer");
    const maxReading = 10 ** (job.vehicle?.digits ?? 6) - 1;
    httpAssert(baseKm + distance <= maxReading, 409, `That distance pushes the odometer past ${maxReading}.`);
  }

  const values = buildReturnLog({
    vehicleId: job.job.vehicleId,
    homeBase: { lat: settings.homeBaseLat, lng: settings.homeBaseLng },
    arriveAt: arrive,
  });

  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(logs).values(values).returning();
    const log = rows[0];
    httpAssert(log, 500, "Failed to create the return log");
    await tx.update(jobs).set({ returnLogId: log.id, updatedAt: new Date() }).where(eq(jobs.id, id));
    return log;
  });

  if (distance != null && baseKm != null) {
    await setLogReading(created.id, baseKm + distance);
  }
  res.status(201).json(toJob(await requireJob(id)));
});

/** Onward business trip: starts where this trip ended (time, place and odometer), with no calendar event. */
jobsRouter.post("/:id/next-trip", async (req, res) => {
  const id = Number(req.params.id);
  const job = await requireJob(id);
  httpAssert(job.job.endLogId != null, 409, "This trip has no end (client arrival) yet");
  const settings = await ensureSettings();

  const values = buildNextTrip({
    job: job.job,
    fromLog: job.returnLog ?? job.endLog,
    now: new Date(),
    timezone: settings.timezone,
  });

  const created = await db.transaction(async (tx) => {
    const jobRows = await tx.insert(jobs).values(values.job).returning();
    const next = jobRows[0];
    httpAssert(next, 500, "Failed to create the next trip");
    const logRows = await tx.insert(logs).values(values.startLog).returning();
    const startLog = logRows[0];
    httpAssert(startLog, 500, "Failed to create the next trip's start log");
    await tx.update(jobs).set({ startLogId: startLog.id, updatedAt: new Date() }).where(eq(jobs.id, next.id));
    return next;
  });
  res.status(201).json(toJob(await requireJob(created.id)));
});

/** Deletes a job and its own photos/logs. Logs still referenced by another job are kept. */
jobsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const job = await requireJob(id);
  const logIds = [job.job.startLogId, job.job.endLogId, job.job.returnLogId].filter((x): x is number => x != null);
  await db.delete(jobs).where(eq(jobs.id, id));
  for (const logId of logIds) {
    const usedElsewhere = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(or(eq(jobs.startLogId, logId), eq(jobs.endLogId, logId), eq(jobs.returnLogId, logId)))
      .limit(1);
    if (usedElsewhere.length > 0) continue;
    await db.delete(logs).where(eq(logs.id, logId));
    await removePhoto(logId);
  }
  res.json({ ok: true });
});
