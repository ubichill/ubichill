CREATE TABLE "publishing_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"api_token_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "publishing_environments_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "publishing_environments_api_token_hash_unique" UNIQUE("api_token_hash")
);
--> statement-breakpoint
-- 他サーバーの確認結果は取り直せるキャッシュなので、1 本鍵の形式のものは捨てる
DELETE FROM "author_bindings";--> statement-breakpoint
ALTER TABLE "author_bindings" ADD COLUMN "keys" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "author_bindings" ADD COLUMN "fetched_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing_environments" ADD CONSTRAINT "publishing_environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publishing_environments_user_id_idx" ON "publishing_environments" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "author_bindings" DROP COLUMN "public_key";--> statement-breakpoint
ALTER TABLE "author_bindings" DROP COLUMN "confirmed_at";--> statement-breakpoint
ALTER TABLE "author_bindings" DROP COLUMN "refreshed_at";--> statement-breakpoint
-- 旧 1 本鍵を公開環境（legacy）として移す。既存の作品の署名はそのまま有効
INSERT INTO "publishing_environments" ("id", "user_id", "kind", "name", "public_key", "created_at")
SELECT gen_random_uuid()::text, "id", 'legacy', '以前の鍵', "signing_public_key", COALESCE("signing_key_updated_at", now())
FROM "users" WHERE "signing_public_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "signing_public_key";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "signing_key_updated_at";