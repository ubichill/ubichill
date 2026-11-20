ALTER TABLE "sessions" ADD COLUMN "password_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_account_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_account_id_accounts_id_fk" FOREIGN KEY ("auth_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_auth_account_id_idx" ON "sessions" USING btree ("auth_account_id");--> statement-breakpoint
-- 外部アカウントを持たないユーザーのセッションは、パスワードでのログインでしか作れない。持つユーザーのセッションは
-- SSO で作られたかもしれないので埋めない（管理者の操作の前に 1 回パスワードで本人確認してもらう）
UPDATE "sessions" AS s SET "password_verified_at" = s."created_at" WHERE s."password_verified_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "accounts" AS a WHERE a."user_id" = s."user_id" AND a."provider_id" LIKE 'fediverse:%');
