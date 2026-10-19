-- 0024 で読み書きをやめた列を消す。0024 のイメージがすべての Pod で動いてから当てる（0023 のイメージは古い列を書き、has_password を読む）。
-- content_hash は 0023・0024 のイメージの migrate.js が埋めている。埋まっていない行があれば、何も変えずに止める
-- （このマイグレーションと 0023 を同じ実行で当てると埋める前にここに来る。先に 0024 のイメージで当てる）。
DO $$
DECLARE
	missing integer;
BEGIN
	SELECT count(*) INTO missing FROM "world_versions" WHERE "content_hash" IS NULL;
	IF missing > 0 THEN
		RAISE EXCEPTION '0025_db_cleanup_drop_columns: content_hash が空の版が % 行あります。0024 のイメージの migrate.js で埋めてから当ててください', missing;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "world_versions" ALTER COLUMN "content_hash" SET NOT NULL;--> statement-breakpoint
DROP TRIGGER "instances_sync_has_password" ON "instances";--> statement-breakpoint
DROP FUNCTION "instances_sync_has_password"();--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "has_password";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "current_users";--> statement-breakpoint
ALTER TABLE "worlds" DROP CONSTRAINT "worlds_name_unique";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "definition";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "lock";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "signature";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "draft_definition";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "draft_lock";--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "draft_updated_at";
