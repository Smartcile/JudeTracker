import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { jobs, logs, vehicles, type JobRow, type LogRow, type VehicleRow } from "../db/schema.ts";
import type { JobAssembled } from "../api/mappers.ts";

async function assemble(rows: JobRow[]): Promise<JobAssembled[]> {
  if (rows.length === 0) return [];
  const jobIds = rows.map((r) => r.id);
  const logIds = [...new Set(rows.flatMap((r) => [r.startLogId, r.endLogId].filter((x): x is number => x != null)))];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter((x): x is number => x != null))];

  const vehicleRows: VehicleRow[] =
    vehicleIds.length > 0 ? await db.select().from(vehicles).where(inArray(vehicles.id, vehicleIds)) : [];
  const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]));
  const logRows: LogRow[] =
    logIds.length > 0 ? await db.select().from(logs).where(inArray(logs.id, logIds)) : [];
  const logById = new Map(logRows.map((l) => [l.id, l]));
  const plateByVehicle = new Map(vehicleRows.map((v) => [v.id, v.plate]));

  return rows.map((job) => ({
    job,
    vehicle: job.vehicleId != null ? vehicleById.get(job.vehicleId) : undefined,
    startLog: job.startLogId != null ? logById.get(job.startLogId) : undefined,
    endLog: job.endLogId != null ? logById.get(job.endLogId) : undefined,
    logPlates: plateByVehicle,
  }));
}

const byNewest = (a: JobRow, b: JobRow) =>
  a.jobDate === b.jobDate ? b.id - a.id : a.jobDate < b.jobDate ? 1 : -1;

/** Jobs newest first. Past jobs are capped (all = true returns everything for exports/totals). */
export async function loadJobs(all = false): Promise<JobAssembled[]> {
  const rows = all
    ? (await db.select().from(jobs)).sort(byNewest)
    : (await db.select().from(jobs).orderBy(desc(jobs.jobDate), desc(jobs.id)).limit(400)).sort(byNewest);
  return assemble(rows);
}

export async function loadJob(id: number): Promise<JobAssembled | undefined> {
  const row = (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
  if (!row) return undefined;
  return (await assemble([row]))[0];
}

export async function recentJobsForVehicle(vehicleId: number, limit = 100): Promise<JobRow[]> {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.vehicleId, vehicleId))
    .orderBy(desc(jobs.jobDate))
    .limit(limit);
}

export async function logsOfVehicle(vehicleId: number): Promise<LogRow[]> {
  return db.select().from(logs).where(eq(logs.vehicleId, vehicleId)).orderBy(asc(logs.takenAt), asc(logs.id));
}
