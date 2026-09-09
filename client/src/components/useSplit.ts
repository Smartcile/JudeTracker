import { analyzeUse, businessUsePct, type UseAnalysis } from "../../../shared/claims.ts";
import type { JobDto } from "../../../shared/types.ts";

export interface UseRow {
  label: string;
  workKm: number;
  personalKm: number;
  totalKm: number;
  pct: number | null;
}

/**
 * Personal-use baseline for a set of jobs (typically already period-filtered).
 * Per vehicle, plus a combined row first. Recomputes whenever readings change,
 * so the percentages always reflect the current logs.
 */
export function useSplit(jobs: JobDto[]): UseRow[] {
  const byVehicle = new Map<number, JobDto[]>();
  const plateOf = new Map<number, string>();
  for (const job of jobs) {
    const vehicleId =
      job.startLog?.vehicleId ?? job.endLog?.vehicleId ?? job.vehicleId;
    if (vehicleId == null) continue;
    if (!byVehicle.has(vehicleId)) byVehicle.set(vehicleId, []);
    byVehicle.get(vehicleId)!.push(job);
    if (job.vehiclePlate) plateOf.set(vehicleId, job.vehiclePlate);
  }

  const rows: UseRow[] = [];
  const all: UseAnalysis = { workKm: 0, personalKm: 0, totalKm: 0 };
  for (const [vehicleId, vehicleJobs] of byVehicle) {
    const a = analyzeUse(vehicleJobs);
    all.workKm += a.workKm;
    all.personalKm += a.personalKm;
    rows.push({
      label: plateOf.get(vehicleId) ?? `Vehicle ${vehicleId}`,
      workKm: a.workKm,
      personalKm: a.personalKm,
      totalKm: a.totalKm,
      pct: businessUsePct(a),
    });
  }
  rows.sort((a, b) => (a.label < b.label ? -1 : 1));
  rows.unshift({
    label: "All vehicles",
    workKm: all.workKm,
    personalKm: all.personalKm,
    totalKm: all.totalKm,
    pct: businessUsePct(all),
  });
  return rows;
}
