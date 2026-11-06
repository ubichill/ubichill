CREATE TABLE "announcement_reads" (
	"user_id" text PRIMARY KEY NOT NULL,
	"read_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" text,
	"actor_uri" text,
	"object" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('Follow', 'Accept', 'Like')),
	CONSTRAINT "notifications_actor_check" CHECK (num_nonnulls("notifications"."actor_user_id", "notifications"."actor_uri") = 1)
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_published_idx" ON "announcements" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_idx" ON "notifications" USING btree ("recipient_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_actor_user_idx" ON "notifications" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
-- 返事を待っている申請を、申請された人の通知（Follow）にする（通知の一覧から承認・拒否できるように）。
-- 時刻は申請した時刻をミリ秒に丸める（一覧のカーソルがミリ秒なので、アプリが書く時刻と揃える）
INSERT INTO "notifications" ("id", "recipient_id", "type", "actor_user_id", "object", "dedupe_key", "created_at")
SELECT 'nf' || md5("user_id" || E'\n' || "friend_id"), "friend_id", 'Follow', "user_id",
       jsonb_build_object('type', 'Person', 'id', "friend_id"), 'Follow:' || "user_id",
       date_trunc('milliseconds', "created_at")
FROM "user_friends" WHERE "status" = 'pending'
ON CONFLICT DO NOTHING;