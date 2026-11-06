-- API の /api/v1/worlds/:worldId を worlds.name から worlds.id に移す。応答の id・保存済みの以前の形の URL（/api/v1/worlds/<name>）が
-- 変わらないよう、id を name と同じ値にそろえる。収まらない行（21 文字を超える name・ほかの行の id と重なる name）は id のまま。
-- world_name_aliases は worlds.id を参照する（ON UPDATE は no action）ので、外部キーを外して両方を書き換えてから張り直す。
ALTER TABLE "world_name_aliases" DROP CONSTRAINT "world_name_aliases_world_id_worlds_id_fk";--> statement-breakpoint
UPDATE "world_name_aliases" a SET "world_id" = w."name"
FROM "worlds" w
WHERE a."world_id" = w."id" AND w."id" <> w."name" AND length(w."name") <= 21
	AND NOT EXISTS (SELECT 1 FROM "worlds" o WHERE o."id" = w."name");--> statement-breakpoint
UPDATE "worlds" w SET "id" = w."name"
WHERE w."id" <> w."name" AND length(w."name") <= 21
	AND NOT EXISTS (SELECT 1 FROM "worlds" o WHERE o."id" = w."name");--> statement-breakpoint
ALTER TABLE "world_name_aliases" ADD CONSTRAINT "world_name_aliases_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "world_drafts" (
	"world_id" varchar(21) PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"lock" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- content_hash は shared の worldContentHash()（正規化した JSON の sha256）でしか求めない。SQL では同じ値を作れないので、
-- 移した行は NULL のまま入れ、migrate.js がこの直後に埋める（backfillWorldContentHashes）。NOT NULL は後続のマイグレーションで付ける。
CREATE TABLE "world_versions" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"world_id" varchar(21) NOT NULL,
	"version" varchar(50) NOT NULL,
	"definition" jsonb NOT NULL,
	"lock" jsonb,
	"signature" jsonb,
	"content_hash" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_versions_world_id_version_unique" UNIQUE("world_id","version"),
	CONSTRAINT "world_versions_world_id_id_unique" UNIQUE("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "world_version_id" varchar(21);--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "current_version_id" varchar(21);--> statement-breakpoint
-- 署名のある行は、公開中の版として 1 行にする（署名が今も有効かは問わない。配るときに毎回確かめるのは今と同じ）。
INSERT INTO "world_versions" ("id", "world_id", "version", "definition", "lock", "signature", "published_at")
SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 21), w."id", w."version", w."definition", w."lock", w."signature", w."updated_at"
FROM "worlds" w
WHERE w."signature" IS NOT NULL;--> statement-breakpoint
UPDATE "worlds" w SET "current_version_id" = v."id"
FROM "world_versions" v
WHERE v."world_id" = w."id";--> statement-breakpoint
-- 下書き: 公開中のワールドは draft_* を、署名の無いワールドは今の定義を下書きにする（未公開のワールドは下書きを署名なしとして配る）。
-- 署名の無い行に draft_* があることは今のコードでは起きないが、あれば作者の新しい方（draft_*）を残す。
INSERT INTO "world_drafts" ("world_id", "definition", "lock", "updated_at")
SELECT w."id",
	COALESCE(w."draft_definition", w."definition"),
	CASE WHEN w."draft_definition" IS NOT NULL THEN w."draft_lock" ELSE w."lock" END,
	COALESCE(w."draft_updated_at", w."updated_at")
FROM "worlds" w
WHERE w."signature" IS NULL OR w."draft_definition" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "world_drafts" ADD CONSTRAINT "world_drafts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_versions" ADD CONSTRAINT "world_versions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_versions_world_id_content_hash_idx" ON "world_versions" USING btree ("world_id","content_hash");--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_world_version_id_world_versions_id_fk" FOREIGN KEY ("world_version_id") REFERENCES "public"."world_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_current_version_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."world_versions"("world_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- worlds の name・version・definition・lock・signature・draft_* は新しいコードが読まないだけで、ここでは消さない
-- （デプロイ中の古い Pod が読み書きするため。後続のマイグレーションで消す）。
CREATE INDEX "instances_world_version_id_idx" ON "instances" USING btree ("world_version_id");
