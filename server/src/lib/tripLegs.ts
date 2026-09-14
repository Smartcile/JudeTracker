import { toLocalDay } from "../../../shared/claims.ts";
import type { JobRow, LogRow } from "../db/schema.ts";

export interface ReturnLogValues {
  vehicleId: number | null;
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  accuracy: null;
  gpsSource: "manual";
  hasPhoto: false;
}

/**
 * The home-arrival reading that closes a trip's return leg: a manual log at the
 * configured home base, no photo. The client (end) log stays the outbound
 * arrival, so the trip's claim covers home → client → home.
 */
export function buildReturnLog(input: {
  vehicleId: number | null;
  homeBase: { lat: number; lng: number };
  arriveAt: Date;
}): ReturnLogValues {
  return {
    vehicleId: input.vehicleId,
    takenAt: input.arriveAt,
    lat: input.homeBase.lat,
    lng: input.homeBase.lng,
    accuracy: null,
    gpsSource: "manual",
    hasPhoto: false,
  };
}

export interface NextTripValues {
  job: {
    client: string;
    location: string;
    locationLat: null;
    locationLng: null;
    notes: string;
    jobDate: string;
    eventUid: null;
    tripKind: "business";
    vehicleId: number | null;
  };
  startLog: {
    vehicleId: number | null;
    takenAt: Date;
    lat: number | null;
    lng: number | null;
    accuracy: null;
    gpsSource: "manual" | "none";
    hasPhoto: false;
    readingKm: number | null;
  };
}

/**
 * Onward business trip ("add a trip on"): starts where the previous trip ended
 * — same time, location point and odometer reading — but carries no calendar
 * event, so the original booking still maps to one trip.
 */
export function buildNextTrip(input: {
  job: Pick<JobRow, "vehicleId" | "locationLat" | "locationLng">;
  /** The trip's last log: the return (home) reading when there is one, else the client arrival. */
  fromLog: Pick<LogRow, "vehicleId" | "takenAt" | "lat" | "lng" | "readingKm"> | undefined;
  now: Date;
  timezone: string;
}): NextTripValues {
  const takenAt = input.fromLog?.takenAt ?? input.now;
  const lat = input.fromLog?.lat ?? input.job.locationLat ?? null;
  const lng = input.fromLog?.lng ?? input.job.locationLng ?? null;
  const hasPoint = lat != null && lng != null;
  const vehicleId = input.job.vehicleId ?? input.fromLog?.vehicleId ?? null;
  return {
    job: {
      client: "BUSINESS TRIP — DETAILS LATER",
      location: "",
      locationLat: null,
      locationLng: null,
      notes: "",
      jobDate: toLocalDay(takenAt, input.timezone),
      eventUid: null,
      tripKind: "business",
      vehicleId,
    },
    startLog: {
      vehicleId,
      takenAt,
      lat: hasPoint ? lat : null,
      lng: hasPoint ? lng : null,
      accuracy: null,
      gpsSource: hasPoint ? "manual" : "none",
      hasPhoto: false,
      readingKm: input.fromLog?.readingKm ?? null,
    },
  };
}
