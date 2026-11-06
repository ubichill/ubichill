-- 0021 の後、username・profile_image_url を読むイメージ（0021 より前）が動いていないことを確かめてから当てる。
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "profile_image_url";
