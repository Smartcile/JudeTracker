export const JOB_STATUSES = ["open", "ready", "claimed", "submitted", "paid"] as const;

export const CLAIM_ORDER = ["open", "ready", "claimed", "submitted", "paid"] as const;

/** Reading capped by the odometer's digit count (e.g. 6 digits => max 999999). */
export function maxReadingForDigits(digits: number): number {
  return 10 ** digits - 1;
}

/** Pad a reading with leading zeros to the odometer digit count. */
export function padReading(km: number, digits: number): string {
  return String(km).padStart(digits, "0");
}

/** Split a padded reading into one character per wheel. */
export function readingToWheels(km: number, digits: number): string[] {
  return padReading(km, digits).split("");
}

/** Build a reading from wheel digits, validating each is 0-9. */
export function wheelsToReading(wheels: string[]): number {
  return Number(wheels.join(""));
}

export interface ClaimComputed {
  km: number | null;
  amountCents: number | null;
}

/**
 * Job distance is end reading minus start reading; money is km times the
 * effective rate (a rate snapshot once the claim has been lodged, otherwise
 * the vehicle's current rate).
 */
export function computeClaim(
  startKm: number | null,
  endKm: number | null,
  effectiveRateCents: number | null,
): ClaimComputed {
  if (startKm == null || endKm == null || endKm < startKm) {
    return { km: null, amountCents: null };
  }
  const km = endKm - startKm;
  return { km, amountCents: effectiveRateCents == null ? null : km * effectiveRateCents };
}

export interface ReturnReadingLike {
  readingKm: number | null;
}

/**
 * The reading that closes a trip's distance: a return (home) leg reading when
 * the trip has one, otherwise the end reading. A return leg without a reading
 * makes the trip incomplete (null) so its claim can't be lodged early.
 */
export function tripEndKm(endKm: number | null, returnLog: ReturnReadingLike | null | undefined): number | null {
  return returnLog ? returnLog.readingKm : endKm;
}

const nzd = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
});

export function formatNzd(cents: number): string {
  return nzd.format(cents / 100);
}

export function formatKm(km: number): string {
  return km.toLocaleString("en-NZ");
}

/** '2026-09-09' style local date for a Date, in a given IANA timezone. */
export function toLocalDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts; // en-CA yields YYYY-MM-DD
}

// --- Tiered (IRD-style) km rates ---------------------------------------------
// Rate 1 applies to the first `tierKm` km claimed per vehicle per NZ claim year
// (1 July - 30 June); rate 2 applies above that. Each vehicle may opt in.

export interface TierRateConfig {
  rateCents: number; // rate 1 (first tier)
  tierKm: number | null; // yearly km threshold, null = no tiering
  tierRateCents: number | null; // rate 2 (above threshold)
}

/** NZ claim-year window containing the given YYYY-MM-DD job date. */
export function fyWindow(jobDate: string): { from: string; to: string } {
  const year = Number(jobDate.slice(0, 4));
  const month = Number(jobDate.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` };
}

/** Effective blended whole-cent rate for `jobKm` km given km already claimed in the year. */
export function tieredBlendedRateCents(cfg: TierRateConfig, claimedSoFarKm: number, jobKm: number): number | null {
  if (cfg.tierKm == null || cfg.tierRateCents == null || cfg.tierKm <= 0) return null;
  if (jobKm <= 0) return cfg.rateCents;
  const remainingFirst = Math.max(0, cfg.tierKm - claimedSoFarKm);
  const atFirst = Math.min(jobKm, remainingFirst);
  const atSecond = jobKm - atFirst;
  const total = atFirst * cfg.rateCents + atSecond * cfg.tierRateCents;
  return Math.round(total / jobKm);
}


// --- Personal-use baseline ------------------------------------------------------
// NZ "actual costs" logbooks need a business-use percentage. Personal km here is
// derived as the odometer distance *between* job photos that no job covers: for
// consecutive readings of the same vehicle, every segment that does not run from
// a job's start log to that same job's end log counts as personal use. Because it
// is recomputed from readings on every render, it stays current when logs change.
import type { LogDto } from "./types.ts";

export interface UseAnalysis {
  workKm: number;
  personalKm: number;
  totalKm: number;
}

interface Bound {
  vehicleId: number;
  at: string;
  logId: number;
  jobId: number;
  readingKm: number;
}

export interface UseJobLike {
  id: number;
  tripKind?: "business" | "personal";
  startLog: LogDto | null;
  endLog: LogDto | null;
  returnLog?: LogDto | null;
}

export function analyzeUse(jobs: UseJobLike[]): UseAnalysis {
  const bounds: Bound[] = [];
  let workKm = 0;
  let personalJobKm = 0;

  for (const job of jobs) {
    const personal = job.tripKind === "personal";
    const start = job.startLog;
    const end = job.endLog;
    const ret = job.returnLog;
    if (start?.vehicleId != null && start.readingKm != null) {
      bounds.push({ vehicleId: start.vehicleId, at: start.takenAt, logId: start.id, jobId: job.id, readingKm: start.readingKm });
    }
    if (end?.vehicleId != null && end.readingKm != null) {
      bounds.push({ vehicleId: end.vehicleId, at: end.takenAt, logId: end.id, jobId: job.id, readingKm: end.readingKm });
    }
    if (ret?.vehicleId != null && ret.readingKm != null) {
      bounds.push({ vehicleId: ret.vehicleId, at: ret.takenAt, logId: ret.id, jobId: job.id, readingKm: ret.readingKm });
    }
    // Until the return reading exists, the outbound leg still counts as work.
    const tripEnd = ret?.readingKm ?? end?.readingKm ?? null;
    if (start?.readingKm != null && tripEnd != null && tripEnd >= start.readingKm) {
      const km = tripEnd - start.readingKm;
      if (personal) personalJobKm += km;
      else workKm += km;
    }
  }

  bounds.sort((a, b) => {
    const at = a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    return at !== 0 ? at : a.logId - b.logId;
  });

  let gapKm = 0;
  let prev: Bound | null = null;
  for (const b of bounds) {
    if (prev && prev.vehicleId === b.vehicleId && prev.jobId !== b.jobId) {
      const gap = b.readingKm - prev.readingKm;
      if (gap > 0) gapKm += gap;
    }
    prev = b;
  }

  const personalKm = personalJobKm + gapKm;
  return { workKm, personalKm, totalKm: workKm + personalKm };
}

/** Business-use share (0-100, one decimal) or null when nothing is logged. */
export function businessUsePct(analysis: UseAnalysis): number | null {
  if (analysis.totalKm <= 0) return null;
  return Math.round((analysis.workKm / analysis.totalKm) * 1000) / 10;
}
