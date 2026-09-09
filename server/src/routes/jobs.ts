import { Router } from "express";
import { eq, or } from "drizzle-orm";
import { toLocalDay } from "../../../shared/claims.ts";
import { toJob, type JobAssembled } from "../api/mappers.ts";
import { db } from "../db/index.ts";
import { calendarEvents, jobs, logs } from "../db/schema.ts";
import { HttpError, httpAssert } from "../lib/http.ts";
import { ensureSettings } from "../lib/settingsStore.ts";
import { jobCreateBody, jobPatchBody } from "../lib/validation.ts";
import { loadJob, loadJobs } from "../services/jobs.ts";
import { removePhoto } from "../services/photos.ts";

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
    .values({ client, location, notes: body.notes ?? "", jobDate, eventUid: body.eventUid ?? null, tripKind: body.kind })
    .returning();
  const created = inserted[0];
  httpAssert(created, 500, "Failed to create job");
  res.status(201).json(toJob(await requireJob(created.id)));
});

jobsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = jobPatchBody.parse(req.body);
  await requireJob(id);
  httpAssert(
    body.client !== undefined ||
      body.location !== undefined ||
      body.notes !== undefined ||
      body.eventUid !== undefined,
    400,
    "Nothing to update",
  );
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.client !== undefined) updates.client = body.client;
  if (body.location !== undefined) updates.location = body.location;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.eventUid !== undefined) {
    if (body.eventUid !== null) {
      const ev = (await db.select().from(calendarEvents).where(eq(calendarEvents.uid, body.eventUid)))[0];
      httpAssert(ev, 404, "Calendar event not found");
    }
    updates.eventUid = body.eventUid;
  }
  await db
    .update(jobs)
    .set(updates)
    .where(eq(jobs.id, id));
  res.json(toJob(await requireJob(id)));
});


/** Deletes a job and its own photos/logs. Logs still referenced by another job are kept. */
jobsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const job = await requireJob(id);
  const logIds = [job.job.startLogId, job.job.endLogId].filter((x): x is number => x != null);
  await db.delete(jobs).where(eq(jobs.id, id));
  for (const logId of logIds) {
    const usedElsewhere = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(or(eq(jobs.startLogId, logId), eq(jobs.endLogId, logId)))
      .limit(1);
    if (usedElsewhere.length > 0) continue;
    await db.delete(logs).where(eq(logs.id, logId));
    await removePhoto(logId);
  }
  res.json({ ok: true });
});
