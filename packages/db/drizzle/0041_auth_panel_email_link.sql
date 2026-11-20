CREATE TABLE "email_link_requests" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "featured_fediverse_servers" (
	"host" varchar(253) PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_link_requests" ADD CONSTRAINT "email_link_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_link_requests_expires_at_idx" ON "email_link_requests" USING btree ("expires_at");--> statement-breakpoint
-- 今まで shared の FEATURED_FEDIVERSE_SERVERS で並べていたサーバー（以後はコントロールパネルで変える）
INSERT INTO "featured_fediverse_servers" ("host", "position") VALUES ('misskey.io', 0), ('mstdn.jp', 1), ('mastodon.social', 2), ('misskey.niri.la', 3) ON CONFLICT DO NOTHING;
