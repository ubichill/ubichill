CREATE TABLE "server_branding" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"short_name" varchar(16),
	"theme_color" varchar(7),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_branding_single_row" CHECK ("server_branding"."id" = 'current')
);
--> statement-breakpoint
CREATE TABLE "server_images" (
	"variant" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_images_kind_check" CHECK ("server_images"."kind" IN ('icon', 'banner'))
);
