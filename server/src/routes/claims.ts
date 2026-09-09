import { Router } from "express";
import { eq } from "drizzle-orm";
import { fyWindow, tieredBlendedRateCents } from "../../../shared/claims.ts";
import { toJob } from "../api/mappers.ts";
import { db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { claimBody } from "../lib/validation.ts";
import { requireJob } from "./jobs.ts";
import { loadJobs } from "../services/jobs.ts";
import type { JobAssembled } from "../api/mappers.ts";

export const claimsRouter = Router();

/** Km already lodged for this vehicle in the same claim year (excludes this job). */
async function claimedKmSameYear(job: JobAssembled): Promise<number> {
  const vehicleId = job.job.vehicleId;
  if (vehicleId == null) return 0;
  const window = fyWindow(job.job.jobDate);
  let total = 0;
  for (const other of await loadJobs(true)) {
    if (
      other.job.id === job.job.id ||
      other.job.vehicleId !== vehicleId ||
      other.job.jobDate < window.from ||
      other.job.jobDate > window.to
    ) {
      continue;
    }
    const s = other.job.status;
    if (s !== "claimed" && s !== "submitted" && s !== "paid") continue;
    const start = other.startLog?.readingKm;
    const end = other.endLog?.readingKm;
    if (start == null || end == null || end < start) continue;
    total += end - start;
  }
  return total;
}

/** Effective snapshot rate for the job: flat rate, or IRD-style tier blend. */
async function snapshotRateFor(job: JobAssembled, jobKm: number): Promise<number> {
  const vehicle = job.vehicle;
  httpAssert(vehicle, 409, "Job has no vehicle - add one before claiming");
  const rate = vehicle.rateCents;
  httpAssert(rate != null, 409, "Job has no vehicle rate - add a vehicle first");
  if (vehicle.tierKm != null && vehicle.tierRateCents != null && jobKm > 0) {
    const soFar = await claimedKmSameYear(job);
    return tieredBlendedRateCents(vehicle, soFar, jobKm) ?? rate;
  }
  return rate;
}

claimsRouter.post("/jobs/:id/claim", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = claimBody.parse(req.body);
  const job = await requireJob(id);
  const row = job.job;

  const transitions: Record<string, string[]> = {
    claimed: ["open", "ready"],
    submitted: ["claimed"],
    paid: ["submitted"],
  };
  const from = transitions[status];
  httpAssert(from, 400, "Unsupported claim status");
  if (row.status !== status) {
    httpAssert(from.includes(row.status), 409, `Can't move a ${row.status} job to ${status}`);
  }

  if (status === "claimed") {
    const start = job.startLog?.readingKm;
    const end = job.endLog?.readingKm;
    httpAssert(job.startLog && job.endLog && start != null && end != null, 409, "Both readings are needed before claiming");
    httpAssert(job.job.tripKind !== "personal", 409, "Personal trips are not claimable");
    const jobKm = end - start;
    const rate = await snapshotRateFor(job, jobKm);
    await db
      .update(jobs)
      .set({ status, rateCents: rate, claimedAt: row.claimedAt ?? new Date() })
      .where(eq(jobs.id, id));
  } else {
    const stamp = status === "submitted" ? "submittedAt" : "paidAt";
    await db
      .update(jobs)
      .set({ status, [stamp]: new Date(), updatedAt: new Date() })
      .where(eq(jobs.id, id));
  }
  res.json(toJob(await requireJob(id)));
});

claimsRouter.post("/jobs/:id/reopen", async (req, res) => {
  const id = Number(req.params.id);
  const job = await requireJob(id);
  httpAssert(
    job.job.status === "claimed" || job.job.status === "submitted" || job.job.status === "paid",
    409,
    "Only claimed/submitted/paid jobs can be reopened",
  );
  await db
    .update(jobs)
    .set({
      status: "ready",
      rateCents: null,
      claimedAt: null,
      submittedAt: null,
      paidAt: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
  res.json(toJob(await requireJob(id)));
});
