export type JobStatus = "open" | "ready" | "claimed" | "submitted" | "paid";
export type TripKind = "business" | "personal";

export interface VehicleDto {
  id: number;
  plate: string;
  make: string;
  model: string;
  rateCents: number;
  tierKm: number | null;
  tierRateCents: number | null;
  digits: number;
  active: boolean;
}

export interface LogDto {
  id: number;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  gpsSource: "live" | "exif" | "manual" | "none";
  readingKm: number | null;
  vehicleId: number | null;
  vehiclePlate: string | null;
  startJobId: number | null;
  endJobId: number | null;
  hasPhoto: boolean;
  createdAt: string;
}

export interface JobDto {
  id: number;
  client: string;
  location: string;
  notes: string;
  jobDate: string;
  eventUid: string | null;
  tripKind: TripKind;
  status: JobStatus;
  vehicleId: number | null;
  vehiclePlate: string | null;
  startLogId: number | null;
  endLogId: number | null;
  km: number | null;
  effectiveRateCents: number | null;
  amountCents: number | null;
  claimedAt: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  startLog: LogDto | null;
  endLog: LogDto | null;
}

export interface CalEventDto {
  uid: string;
  summary: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
}

export interface SettingsDto {
  timezone: string;
  calendarUrl: string | null;
  calendarLabel: string;
  lastSyncAt: string | null;
  syncError: string | null;
  pinSet: boolean;
}

export interface AuthStateDto {
  authed: boolean;
  needsSetup: boolean;
}

export interface ReadingInfoDto {
  log: LogDto;
  jobId: number | null;
  jobStatus: JobStatus | null;
  role: "start" | "end" | null;
  vehicleDigits: number | null;
  floorKm: number;
  canEdit: boolean;
}

export interface ClaimRowDto {
  jobId: number;
  client: string;
  jobDate: string;
  plate: string | null;
  startKm: number | null;
  endKm: number | null;
  km: number | null;
  rateCents: number | null;
  amountCents: number | null;
  status: JobStatus;
}

export interface ClaimSummaryDto {
  rows: ClaimRowDto[];
  totals: { km: number; amountCents: number; count: number };
  byStatus: Record<string, { km: number; amountCents: number; count: number }>;
  byVehicle: Record<string, { km: number; amountCents: number; count: number }>;
}
