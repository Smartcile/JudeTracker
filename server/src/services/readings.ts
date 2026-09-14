import { and, eq, ne, or } from "drizzle-orm";
import type { JobStatus } from "../../../shared/types.ts";
import { tripEndKm } from "../../../shared/claims.ts";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles, type LogRow } from "../db/schema.ts";
import { HttpError } from "../lib/http.ts";

export type JobLogRole = "start" | "end" | "return";

export interface ReadingContext {
  floorKm: number;
  capKm: number | null;
  prevReadingKm: number | null;
  jobId: number | null;
  jobStatus: JobStatus | null;
  role: JobLogRole | null;
  vehicleDigits: number | null;
  canEdit: boolean;
}

export interface LogWithJob extends LogRow {
  jobRole: JobLogRole | null;
  jobId: number | null;
  jobStatus: JobStatus | null;
}

/** Fetch a log together with the job (if any) that references it as start, end or return. */
export async function logWithJob(logId: number): Promise<LogWithJob | undefined> {
  const log = (await db.select().from(logs).where(eq(logs.id, logId)))[0];
  if (!log) return undefined;
  const job = (
    await db
      .select()
      .from(jobs)
      .where(or(eq(jobs.startLogId, logId), eq(jobs.endLogId, logId), eq(jobs.returnLogId, logId)))
  )[0];
  if (!job) return { ...log, jobRole: null, jobId: null, jobStatus: null };
  const jobRole: JobLogRole = job.startLogId === logId ? "start" : job.endLogId === logId ? "end" : "return";
  return {
    ...log,
    jobRole,
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

  if (lwj.jobId != null) {
    const job = (await db.select().from(jobs).where(eq(jobs.id, lwj.jobId)))[0];
    if (job) {
      const siblingIds: Array<[JobLogRole, number | null]> = [
        ["start", job.startLogId],
        ["end", job.endLogId],
        ["return", job.returnLogId],
      ];
      const readings = new Map<JobLogRole, number | null>();
      for (const [role, id] of siblingIds) {
        if (id == null || id === lwj.id) continue;
        readings.set(role, (await db.select().from(logs).where(eq(logs.id, id)))[0]?.readingKm ?? null);
      }
      const startReading = readings.get("start") ?? null;
      const endReading = readings.get("end") ?? null;
      const returnReading = readings.get("return") ?? null;
      if (lwj.jobRole === "end") {
        if (startReading != null) floor = Math.max(floor, startReading);
        if (returnReading != null) cap = returnReading;
      } else if (lwj.jobRole === "return") {
        if (startReading != null) floor = Math.max(floor, startReading);
        if (endReading != null) floor = Math.max(floor, endReading);
      } else if (lwj.jobRole === "start") {
        const next = endReading ?? returnReading;
        if (next != null) cap = next;
      }
    }
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
      const ret = job.returnLogId != null ? (await db.select().from(logs).where(eq(logs.id, job.returnLogId)))[0] : undefined;
      const startKm = start?.readingKm ?? null;
      const endKm = end?.readingKm ?? null;
      const tripEnd = tripEndKm(endKm, ret);
      if (startKm != null && endKm != null && tripEnd != null && tripEnd >= startKm) {
        await db.update(jobs).set({ status: "ready" }).where(eq(jobs.id, job.id));
      }
    }
  }
}
