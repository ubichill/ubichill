CREATE TABLE "server_info" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"maintainer_name" varchar(64),
	"maintainer_email" text,
	"tos_url" text,
	"privacy_policy_url" text,
	"inquiry_url" text,
	"repository_url" text,
	"impressum_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_info_single_row" CHECK ("server_info"."id" = 'current')
);
