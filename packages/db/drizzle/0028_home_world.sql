ALTER TABLE "user_settings" ADD COLUMN "home_world_ref" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "home_access_type" "instance_access_type" DEFAULT 'invite_only' NOT NULL;