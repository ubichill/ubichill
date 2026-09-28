ALTER TABLE "users" ADD COLUMN "handle" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signing_public_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signing_key_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");--> statement-breakpoint
-- 既存ユーザーのうち、旧 username がそのまま ID の規則（英数字・_ の 3〜30 文字、小文字化して一意、予約語でない）を
-- 満たす人は handle に引き継ぐ。満たさない人（日本語・記号など）は handle を未設定のままにし、プロフィールで選んでもらう。
UPDATE "users" AS u SET "handle" = lower(u."username")
WHERE u."username" ~ '^[A-Za-z0-9_]{3,30}$'
  AND lower(u."username") NOT IN ('admin','administrator','api','app','auth','help','mod','mods','moderator','official','root','security','settings','support','system','ubichill','user','users','webmaster','world','worlds','www')
  AND (SELECT count(*) FROM "users" AS o WHERE lower(o."username") = lower(u."username")) = 1;
