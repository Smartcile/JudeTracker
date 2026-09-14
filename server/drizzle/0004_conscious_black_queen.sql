CREATE TABLE "geocode_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "home_base_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "home_base_lat" double precision;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "home_base_lng" double precision;