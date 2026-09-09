import { Router } from "express";
import type { ClaimRowDto } from "../../../shared/types.ts";
import { computeClaim } from "../../../shared/claims.ts";
import { loadJobs } from "../services/jobs.ts";

export const exportRouter = Router();

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = ["Job date", "Client", "Vehicle", "Start reading", "End reading", "Km", "Rate ($NZ/km)", "Amount ($NZ)", "Status"];

export async function exportCsv(from?: string, to?: string): Promise<string> {
  const lines = [HEADER.map(csvCell).join(",")];
  for (const a of await loadJobs(true)) {
    if (a.job.tripKind === "personal") continue; // business claim ledger only
    const start = a.startLog?.readingKm ?? null;
    const end = a.endLog?.readingKm ?? null;
    const rateCents = a.job.rateCents ?? a.vehicle?.rateCents ?? null;
    const { km, amountCents } = computeClaim(start, end, rateCents);
    if (km == null) continue;
    if ((from && a.job.jobDate < from) || (to && a.job.jobDate > to)) continue;
    lines.push(
      [
        a.job.jobDate,
        a.job.client,
        a.vehicle?.plate ?? "",
        start ?? "",
        end ?? "",
        km,
        rateCents != null ? rateCents / 100 : "",
        amountCents != null ? amountCents / 100 : "",
        a.job.status,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

exportRouter.get("/export/logbook.csv", async (req, res) => {
  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : undefined;
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : undefined;
  const csv = await exportCsv(from, to);
  res
    .setHeader("Content-Type", "text/csv; charset=utf-8")
    .setHeader("Content-Disposition", `attachment; filename="logbook-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(csv);
});
