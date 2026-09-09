import { and, eq, ne, or } from "drizzle-orm";
import type { JobStatus } from "../../../shared/types.ts";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles, type LogRow } from "../db/schema.ts";
import { HttpError } from "../lib/http.ts";

export interface ReadingContext {
  floorKm: number;
  capKm: number | null;
  prevReadingKm: number | null;
  jobId: number | null;
  jobStatus: JobStatus | null;
  role: "start" | "end" | null;
  vehicleDigits: number | null;
  canEdit: boolean;
}

export interface LogWithJob extends LogRow {
  jobRole: "start" | "end" | null;
  jobId: number | null;
  jobStatus: JobStatus | null;
}

/** Fetch a log together with the job (if any) that references it as start or end. */
export async function logWithJob(logId: number): Promise<LogWithJob | undefined> {
  const log = (await db.select().from(logs).where(eq(logs.id, logId)))[0];
  if (!log) return undefined;
  const job = (
    await db
      .select()
      .from(jobs)
      .where(or(eq(jobs.startLogId, logId), eq(jobs.endLogId, logId)))
  )[0];
  if (!job) return { ...log, jobRole: null, jobId: null, jobStatus: null };
  return {
    ...log,
    jobRole: job.startLogId === logId ? "start" : "end",
    jobId: job.id,
    jobStatus: job.status as JobStatus,
  };
}

/** Strictly-earlier read logs of the same vehicle, chronological. */
export async function previousVehicleReads(log: LogRow): Promise<LogRow[]> {
  if (log.vehicleId == null) return [];
  const rows = await db
    .select()
    .from(logs)
    .where(and(eq(logs.vehicleId, log.vehicleId), ne(logs.id, log.id)))
    .orderBy(logs.takenAt);
  return rows.filter((r) => r.readingKm != null);
}

export async function previousReadingOf(log: LogRow): Promise<number | null> {
  const prevs = await previousVehicleReads(log);
  for (let i = prevs.length - 1; i >= 0; i--) {
    const p = prevs[i];
    if (p) {
      const before =
        p.takenAt.getTime() < log.takenAt.getTime() ||
        (p.takenAt.getTime() === log.takenAt.getTime() && p.id < log.id);
      if (before) return p.readingKm;
    }
  }
  return null;
}

export async function readingContext(logId: number): Promise<ReadingContext | undefined> {
  const lwj = await logWithJob(logId);
  if (!lwj) return undefined;

  const prev = await previousReadingOf(lwj);
  const vehicle = lwj.vehicleId != null
    ? (await db.select().from(vehicles).where(eq(vehicles.id, lwj.vehicleId)))[0]
    : undefined;

  let floor = prev ?? 0;
  let cap: number | null = null;
  let jobStartReading: number | null = null;
  let jobEndReading: number | null = null;

  if (lwj.jobId != null) {
    const job = (await db.select().from(jobs).where(eq(jobs.id, lwj.jobId)))[0];
    if (job) {
      if (job.startLogId != null && job.startLogId !== lwj.id) {
        jobStartReading = (await db.select().from(logs).where(eq(logs.id, job.startLogId)))[0]?.readingKm ?? null;
      }
      if (job.endLogId != null && job.endLogId !== lwj.id) {
        jobEndReading = (await db.select().from(logs).where(eq(logs.id, job.endLogId)))[0]?.readingKm ?? null;
      }
    }
    if (lwj.jobRole === "end" && jobStartReading != null) floor = Math.max(floor, jobStartReading);
    if (lwj.jobRole === "start" && jobEndReading != null) cap = jobEndReading;
  }

  const claimed = lwj.jobStatus === "claimed" || lwj.jobStatus === "submitted" || lwj.jobStatus === "paid";
  return {
    floorKm: floor,
    capKm: cap,
    prevReadingKm: prev,
    jobId: lwj.jobId,
    jobStatus: lwj.jobStatus,
    role: lwj.jobRole,
    vehicleDigits: vehicle?.digits ?? null,
    canEdit: !claimed,
  };
}

export async function setLogReading(logId: number, readingKm: number): Promise<void> {
  const ctx = await readingContext(logId);
  if (!ctx) throw new HttpError(404, "Log not found");
  if (!ctx.canEdit) throw new HttpError(409, "This job's claim has already been lodged. Reopen it to edit readings.");
  if (ctx.vehicleDigits == null) throw new HttpError(409, "Attach a vehicle before entering a reading.");
  const maxReading = 10 ** ctx.vehicleDigits - 1;
  if (readingKm > maxReading) {
    throw new HttpError(409, `This odometer only shows ${ctx.vehicleDigits} digits (max ${maxReading}).`);
  }
  if (readingKm < ctx.floorKm) {
    throw new HttpError(409, `Reading can't go below ${ctx.floorKm} (previous reading / job start).`);
  }
  if (ctx.capKm != null && readingKm > ctx.capKm) {
    throw new HttpError(409, `Start reading can't exceed the job's end reading (${ctx.capKm}).`);
  }

  await db
    .update(logs)
    .set({ readingKm, readingUpdatedAt: new Date() })
    .where(eq(logs.id, logId));

  if (ctx.jobId != null && ctx.jobStatus === "open") {
    const job = (await db.select().from(jobs).where(eq(jobs.id, ctx.jobId)))[0];
    if (job && job.tripKind !== "personal") {
      const start = job.startLogId != null ? (await db.select().from(logs).where(eq(logs.id, job.startLogId)))[0] : undefined;
      const end = job.endLogId != null ? (await db.select().from(logs).where(eq(logs.id, job.endLogId)))[0] : undefined;
      if (start?.readingKm != null && end?.readingKm != null && end.readingKm >= start.readingKm) {
        await db.update(jobs).set({ status: "ready" }).where(eq(jobs.id, job.id));
      }
    }
  }
}
