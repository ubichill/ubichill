ALTER TABLE "worlds" ADD COLUMN "draft_definition" jsonb;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "draft_lock" jsonb;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "draft_updated_at" timestamp;