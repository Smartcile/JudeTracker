import type { JobStatus, TripKind } from "../../../shared/types.ts";
import { computeClaim } from "../../../shared/claims.ts";
import type {
  CalEventDto,
  JobDto,
  LogDto,
  SettingsDto,
  VehicleDto,
} from "../../../shared/types.ts";
import type { CalendarEventRow, JobRow, LogRow, SettingsRow, VehicleRow } from "../db/schema.ts";

export function toVehicle(v: VehicleRow): VehicleDto {
  return {
    id: v.id,
    plate: v.plate,
    make: v.make,
    model: v.model,
    rateCents: v.rateCents,
    tierKm: v.tierKm,
    tierRateCents: v.tierRateCents,
    digits: v.digits,
    active: v.active,
  };
}

export function toLog(log: LogRow, plateByVehicle?: Map<number, string>): LogDto {
  return {
    id: log.id,
    takenAt: log.takenAt.toISOString(),
    lat: log.lat,
    lng: log.lng,
    accuracy: log.accuracy,
    gpsSource: (log.gpsSource ?? "none") as LogDto["gpsSource"],
    readingKm: log.readingKm,
    vehicleId: log.vehicleId,
    vehiclePlate: log.vehicleId != null ? plateByVehicle?.get(log.vehicleId) ?? null : null,
    startJobId: null,
    endJobId: null,
    hasPhoto: log.hasPhoto,
    createdAt: log.createdAt.toISOString(),
  };
}

export function toSettings(s: SettingsRow): SettingsDto {
  return {
    timezone: s.timezone,
    calendarUrl: s.calendarUrl,
    calendarLabel: s.calendarLabel,
    homeBaseAddress: s.homeBaseAddress,
    homeBaseLat: s.homeBaseLat,
    homeBaseLng: s.homeBaseLng,
    lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
    syncError: s.syncError,
    pinSet: s.pinHash != null,
  };
}

export function toCalEvent(e: CalendarEventRow): CalEventDto {
  return {
    uid: e.uid,
    summary: e.summary,
    location: e.location,
    startAt: e.startAt?.toISOString() ?? null,
    endAt: e.endAt?.toISOString() ?? null,
    allDay: e.allDay,
  };
}

export interface JobAssembled {
  job: JobRow;
  vehicle?: VehicleRow;
  startLog?: LogRow;
  endLog?: LogRow;
  logPlates?: Map<number, string>;
}

export function toJob(a: JobAssembled): JobDto {
  const job = a.job;
  const tripKind = (job.tripKind ?? "business") as TripKind;
  const isBusiness = tripKind === "business";
  const vehicleRate = a.vehicle?.rateCents ?? null;
  const rateCents = isBusiness ? job.rateCents ?? vehicleRate : null;
  const { km, amountCents } = computeClaim(
    a.startLog?.readingKm ?? null,
    a.endLog?.readingKm ?? null,
    rateCents,
  );
  const startLog = a.startLog ? toLog(a.startLog, a.logPlates) : null;
  const endLog = a.endLog ? toLog(a.endLog, a.logPlates) : null;
  return {
    id: job.id,
    client: job.client,
    location: job.location,
    notes: job.notes,
    jobDate: job.jobDate,
    eventUid: job.eventUid,
    tripKind,
    status: job.status as JobStatus,
    vehicleId: job.vehicleId,
    vehiclePlate: a.vehicle?.plate ?? null,
    startLogId: job.startLogId,
    endLogId: job.endLogId,
    km,
    effectiveRateCents: rateCents,
    amountCents,
    claimedAt: job.claimedAt?.toISOString() ?? null,
    submittedAt: job.submittedAt?.toISOString() ?? null,
    paidAt: job.paidAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    startLog,
    endLog,
  };
}

export function assertJobStatus(v: string): JobStatus {
  const ok: JobStatus[] = ["open", "ready", "claimed", "submitted", "paid"];
  if (!ok.includes(v as JobStatus)) throw new Error(`Bad job status: ${v}`);
  return v as JobStatus;
}
