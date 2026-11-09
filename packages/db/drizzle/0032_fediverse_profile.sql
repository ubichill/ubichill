ALTER TABLE "remote_actors" ADD COLUMN "banner" text;--> statement-breakpoint
ALTER TABLE "remote_actors" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;