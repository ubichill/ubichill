CREATE TABLE "storage_settings" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"world_asset_quota_bytes" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_settings_single_row" CHECK ("storage_settings"."id" = 'current')
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "world_asset_auto_cleanup" boolean DEFAULT true NOT NULL;