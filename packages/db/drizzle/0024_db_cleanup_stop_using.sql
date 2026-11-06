-- worlds の 0023 より前の列（name・version・definition・lock・signature・draft_*）を新しいコードは書かない。列は消さず
-- （デプロイ中の 0023 のイメージが INSERT で書く）、新しいコードの INSERT が通るよう NOT NULL だけ外す。消すのは 0025。
ALTER TABLE "worlds" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "definition" DROP NOT NULL;--> statement-breakpoint
-- instances.has_password を新しいコードは読み書きしない（password_hash IS NOT NULL で判定する）。0023 のイメージは
-- has_password だけを見て入室のパスワードを確かめるので、新しいコードが作ったパスワード付きのインスタンスに、デプロイ中や
-- 戻したあとの古い Pod からパスワードなしで入れないよう、DB の側で password_hash から決める。列と一緒に 0025 で消す。
UPDATE "instances" SET "has_password" = ("password_hash" IS NOT NULL)
WHERE "has_password" IS DISTINCT FROM ("password_hash" IS NOT NULL);--> statement-breakpoint
CREATE FUNCTION "instances_sync_has_password"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW."has_password" := NEW."password_hash" IS NOT NULL;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "instances_sync_has_password" BEFORE INSERT OR UPDATE ON "instances"
FOR EACH ROW EXECUTE FUNCTION "instances_sync_has_password"();--> statement-breakpoint
-- 0020 で author_keys・remote_authors に移した古い鍵のテーブル。0020 以降のイメージはどれも読み書きしない。
DROP TABLE "publishing_environments";--> statement-breakpoint
DROP TABLE "author_bindings";
