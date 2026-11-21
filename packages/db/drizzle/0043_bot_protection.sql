CREATE TABLE "bot_protection_settings" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"provider" text NOT NULL,
	"site_key" text NOT NULL,
	"secret" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_protection_settings_single_row" CHECK ("bot_protection_settings"."id" = 'current')
);
