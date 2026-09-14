import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { GeocodeResultDto } from "../../../shared/types.ts";

export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  pinHash: text("pin_hash"),
  timezone: text("timezone").notNull().default("Pacific/Auckland"),
  calendarUrl: text("calendar_url"),
  calendarLabel: text("calendar_label").notNull().default("Client calendar"),
  homeBaseAddress: text("home_base_address").notNull().default(""),
  homeBaseLat: doublePrecision("home_base_lat"),
  homeBaseLng: doublePrecision("home_base_lng"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  syncError: text("sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const geocodeCache = pgTable("geocode_cache", {
  query: text("query").primaryKey(),
  results: jsonb("results").$type<GeocodeResultDto[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable("vehicles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  plate: text("plate").notNull(),
  make: text("make").notNull().default(""),
  model: text("model").notNull().default(""),
  rateCents: integer("rate_cents").notNull(),
  tierKm: integer("tier_km"),
  tierRateCents: integer("tier_rate_cents"),
  digits: integer("digits").notNull().default(6),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("vehicles_plate_uq").on(t.plate)]);

export const calendarEvents = pgTable("calendar_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  uid: text("uid").notNull(),
  summary: text("summary").notNull().default(""),
  location: text("location").notNull().default(""),
  description: text("description").notNull().default(""),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("calendar_events_uid_uq").on(t.uid)]);

export const logs = pgTable("logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracy: integer("accuracy"),
  gpsSource: text("gps_source").notNull().default("none"),
  readingKm: integer("reading_km"),
  readingUpdatedAt: timestamp("reading_updated_at", { withTimezone: true }),
  hasPhoto: boolean("has_photo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  client: text("client").notNull(),
  location: text("location").notNull().default(""),
  notes: text("notes").notNull().default(""),
  jobDate: date("job_date").notNull(),
  eventUid: text("event_uid"),
  tripKind: text("trip_kind").notNull().default("business"),
  status: text("status").notNull().default("open"),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  startLogId: integer("start_log_id").references(() => logs.id),
  endLogId: integer("end_log_id").references(() => logs.id),
  rateCents: integer("rate_cents"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("jobs_vehicle_start_uq").on(t.vehicleId, t.startLogId)]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SettingsRow = typeof settings.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type LogRow = typeof logs.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
