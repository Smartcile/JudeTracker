import { toLocalDay } from "../../../shared/claims.ts";
import type { JobRow, LogRow } from "../db/schema.ts";

export interface ReturnTripValues {
  job: {
    client: string;
    location: string;
    notes: string;
    jobDate: string;
    eventUid: null;
    tripKind: string;
    vehicleId: number | null;
  };
  startLog: {
    vehicleId: number | null;
    takenAt: Date;
    lat: number | null;
    lng: number | null;
    accuracy: null;
    gpsSource: string;
    hasPhoto: boolean;
  };
  endLog: {
    vehicleId: number | null;
    takenAt: Date;
    lat: number | null;
    lng: number | null;
    accuracy: null;
    gpsSource: string;
    hasPhoto: boolean;
  };
}

/**
 * The client → home leg of a trip: starts where the outbound trip ended and
 * finishes at the configured home base. Both logs are manual (no photo); the
 * return job is deliberately not linked to the calendar event so the event
 * still maps to one trip in the pickers.
 */
export function buildReturnTrip(input: {
  job: Pick<JobRow, "client" | "tripKind" | "vehicleId">;
  outboundEnd: Pick<LogRow, "lat" | "lng"> | undefined;
  homeBase: { address: string; lat: number; lng: number };
  departAt: Date;
  arriveAt: Date;
  timezone: string;
}): ReturnTripValues {
  const vehicleId = input.job.vehicleId;
  const startLat = input.outboundEnd?.lat ?? null;
  const startLng = input.outboundEnd?.lng ?? null;
  const hasStartPoint = startLat != null && startLng != null;
  return {
    job: {
      client: input.job.client,
      location: input.homeBase.address || "Home base",
      notes: "Return leg — drive home",
      jobDate: toLocalDay(input.departAt, input.timezone),
      eventUid: null,
      tripKind: input.job.tripKind,
      vehicleId,
    },
    startLog: {
      vehicleId,
      takenAt: input.departAt,
      lat: hasStartPoint ? startLat : null,
      lng: hasStartPoint ? startLng : null,
      accuracy: null,
      gpsSource: hasStartPoint ? "manual" : "none",
      hasPhoto: false,
    },
    endLog: {
      vehicleId,
      takenAt: input.arriveAt,
      lat: input.homeBase.lat,
      lng: input.homeBase.lng,
      accuracy: null,
      gpsSource: "manual",
      hasPhoto: false,
    },
  };
}
