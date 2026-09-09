import { Router } from "express";
import type { ClaimRowDto, ClaimSummaryDto } from "../../../shared/types.ts";
import { computeClaim } from "../../../shared/claims.ts";
import type { JobAssembled } from "../api/mappers.ts";
import { loadJobs } from "../services/jobs.ts";

export const summaryRouter = Router();

function inRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function toRow(a: JobAssembled): ClaimRowDto | null {
  if (a.job.tripKind === "personal") return null;
  const start = a.startLog?.readingKm ?? null;
  const end = a.endLog?.readingKm ?? null;
  const rateCents = a.job.rateCents ?? a.vehicle?.rateCents ?? null;
  const { km, amountCents } = computeClaim(start, end, rateCents);
  if (km == null) return null;
  return {
    jobId: a.job.id,
    client: a.job.client,
    jobDate: a.job.jobDate,
    plate: a.vehicle?.plate ?? null,
    startKm: start,
    endKm: end,
    km,
    rateCents,
    amountCents,
    status: a.job.status as ClaimRowDto["status"],
  };
}

summaryRouter.get("/claims/summary", async (req, res) => {
  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : undefined;
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : undefined;

  const empty = () => ({ km: 0, amountCents: 0, count: 0 });
  const totals = empty();
  const byStatus: Record<string, ReturnType<typeof empty>> = {};
  const byVehicle: Record<string, ReturnType<typeof empty>> = {};

  const rows: ClaimRowDto[] = [];
  for (const a of await loadJobs(true)) {
    if (!inRange(a.job.jobDate, from, to)) continue;
    const row = toRow(a);
    if (!row) continue;
    rows.push(row);
    const add = (bucket: ReturnType<typeof empty>) => {
      bucket.km += row.km ?? 0;
      bucket.amountCents += row.amountCents ?? 0;
      bucket.count += 1;
    };
    add(totals);
    const statusBucket = (byStatus[row.status] ??= empty());
    add(statusBucket);
    const key = row.plate ?? "Unassigned";
    const vehicleBucket = (byVehicle[key] ??= empty());
    add(vehicleBucket);
  }

  const out: ClaimSummaryDto = { rows, totals, byStatus, byVehicle };
  res.json(out);
});
