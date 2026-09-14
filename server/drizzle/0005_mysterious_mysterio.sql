CREATE TABLE "places" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "places_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "location_lat" double precision;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "location_lng" double precision;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "return_log_id" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_return_log_id_logs_id_fk" FOREIGN KEY ("return_log_id") REFERENCES "public"."logs"("id") ON DELETE no action ON UPDATE no action;