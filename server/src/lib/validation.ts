import { z } from "zod";
import { CLAIM_ORDER } from "../../../shared/claims.ts";

export const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

export const setupBody = z.object({ pin: pinSchema });

export const loginBody = z.object({ pin: pinSchema });

export const changePinBody = z.object({
  currentPin: pinSchema,
  newPin: pinSchema,
});

export const vehicleBody = z
  .object({
    plate: z.string().trim().min(1, "Plate is required").max(12).transform((s) => s.toUpperCase()),
    make: z.string().trim().max(40).default(""),
    model: z.string().trim().max(40).default(""),
    rateCents: z.number().int().min(0).max(10000),
    tierKm: z.number().int().min(1).nullable().optional(),
    tierRateCents: z.number().int().min(0).max(10000).nullable().optional(),
    digits: z.number().int().min(5).max(7).default(6),
    active: z.boolean().default(true),
  })
  .transform((v) => {
    const tiered = v.tierKm != null && v.tierRateCents != null;
    return {
      ...v,
      tierKm: tiered ? v.tierKm : null,
      tierRateCents: tiered ? v.tierRateCents : null,
    };
  });

export const settingsBody = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    calendarUrl: z.string().trim().url("Calendar link must be a URL").nullable().optional(),
    calendarLabel: z.string().trim().max(80).optional(),
    homeBaseAddress: z.string().trim().max(200).optional(),
    homeBaseLat: z.number().min(-90).max(90).nullable().optional(),
    homeBaseLng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.homeBaseLat === undefined && v.homeBaseLng === undefined) ||
      (v.homeBaseLat === null && v.homeBaseLng === null) ||
      (typeof v.homeBaseLat === "number" && typeof v.homeBaseLng === "number"),
    "Set or clear the home base coordinates together",
  );

const up = (max: number) => (s: string) => s.trim().toUpperCase().slice(0, max);

const realDay = (s: string): boolean => {
  const p = s.split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
};

export const jobDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(realDay, "Not a real calendar day");

const coordPair = {
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
};

const coordsPaired = (v: { locationLat?: number | null; locationLng?: number | null }): boolean =>
  (v.locationLat === undefined && v.locationLng === undefined) ||
  (v.locationLat === null && v.locationLng === null) ||
  (typeof v.locationLat === "number" && typeof v.locationLng === "number");

export const jobCreateBody = z
  .object({
    eventUid: z.string().optional(),
    client: z.string().trim().transform(up(120)).optional(),
    location: z.string().trim().transform(up(200)).optional(),
    ...coordPair,
    jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    kind: z.enum(["business", "personal"]).default("business"),
    notes: z.string().trim().transform(up(500)).optional(),
  })
  .refine(coordsPaired, "Set or clear the location coordinates together");

export const jobPatchBody = z
  .object({
    client: z.string().trim().min(1).transform(up(120)).optional(),
    location: z.string().trim().transform(up(200)).optional(),
    ...coordPair,
    notes: z.string().trim().transform(up(500)).optional(),
    eventUid: z.string().trim().min(1).max(500).nullable().optional(),
    jobDate: jobDateField.optional(),
    vehicleId: z.number().int().positive().nullable().optional(),
  })
  .refine(coordsPaired, "Set or clear the location coordinates together");

export const logPatchBody = z
  .object({
    takenAt: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid timestamp").optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    locationLabel: z.string().trim().max(200).optional(),
  })
  .refine(
    (v) =>
      (v.lat === undefined && v.lng === undefined) ||
      (v.lat !== undefined && v.lng !== undefined && (v.lat == null) === (v.lng == null)),
    "Set or clear lat and lng together",
  );

export const pairBody = z.object({
  startLogId: z.number().int().positive().nullable().optional(),
  endLogId: z.number().int().positive().nullable().optional(),
});

export const readingBody = z.object({
  readingKm: z.number().int().min(0),
});

const isoInstant = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid timestamp");

export const returnLogBody = z
  .object({
    departAt: isoInstant,
    arriveAt: isoInstant,
    distanceKm: z.number().int().positive().max(2000).nullable().optional(),
  })
  .refine((v) => new Date(v.arriveAt).getTime() > new Date(v.departAt).getTime(), "The return trip must arrive after it departs");

export const placeBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  address: z.string().trim().max(200).default(""),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const claimBody = z.object({
  status: z.enum(["claimed", "submitted", "paid"]),
});

export const logFields = z.object({
  role: z.enum(["start", "end", "return"]).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  takenAt: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  locationLabel: z.string().trim().max(200).default(""),
  accuracy: z.coerce.number().nonnegative().nullable().optional(),
  gpsSource: z.enum(["live", "exif", "manual", "none"]).default("none"),
});

export const claimStatuses = CLAIM_ORDER;
