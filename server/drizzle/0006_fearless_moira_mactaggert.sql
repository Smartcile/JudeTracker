CREATE TABLE "route_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"km" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "location_label" text DEFAULT '' NOT NULL;