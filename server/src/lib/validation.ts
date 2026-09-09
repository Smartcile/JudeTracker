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

export const settingsBody = z.object({
  timezone: z.string().min(1).max(64).default("Pacific/Auckland"),
  calendarUrl: z.string().trim().url("Calendar link must be a URL").nullable(),
  calendarLabel: z.string().trim().max(80).default("Client calendar"),
});

const up = (max: number) => (s: string) => s.trim().toUpperCase().slice(0, max);

export const jobCreateBody = z.object({
  eventUid: z.string().optional(),
  client: z.string().trim().transform(up(120)).optional(),
  location: z.string().trim().transform(up(200)).optional(),
  jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(["business", "personal"]).default("business"),
  notes: z.string().trim().transform(up(500)).optional(),
});

export const jobPatchBody = z.object({
  client: z.string().trim().min(1).transform(up(120)).optional(),
  location: z.string().trim().transform(up(200)).optional(),
  notes: z.string().trim().transform(up(500)).optional(),
  eventUid: z.string().trim().min(1).max(500).nullable().optional(),
});

export const pairBody = z.object({
  startLogId: z.number().int().positive().nullable().optional(),
  endLogId: z.number().int().positive().nullable().optional(),
});

export const readingBody = z.object({
  readingKm: z.number().int().min(0),
});

export const claimBody = z.object({
  status: z.enum(["claimed", "submitted", "paid"]),
});

export const logFields = z.object({
  role: z.enum(["start", "end"]).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  takenAt: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  accuracy: z.coerce.number().nonnegative().nullable().optional(),
  gpsSource: z.enum(["live", "exif", "manual", "none"]).default("none"),
});

export const claimStatuses = CLAIM_ORDER;
