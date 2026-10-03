-- 作者が付けた名前（metadata.name）。これまで本体は metadata.name を URL の ID（name）に書き換えて保存していたので、既存の行は同じ値で埋める
ALTER TABLE "worlds" ADD COLUMN "world_name" varchar(50);--> statement-breakpoint
UPDATE "worlds" SET "world_name" = COALESCE("definition"->'metadata'->>'name', "name");--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "world_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "worlds_author_world_name_unique" ON "worlds" USING btree ("author_id","world_name");
--> statement-breakpoint
-- 本体のワールドの URL を、配信している YAML の URL（.../api/v1/worlds/<id>.yaml）にそろえる（外部ホストと同じ配り方）
DELETE FROM "user_favorites" f WHERE f."world_ref" ~ '/api/v1/worlds/[^/.]+(/yaml)?$' AND EXISTS (SELECT 1 FROM "user_favorites" g WHERE g."user_id" = f."user_id" AND g."world_ref" = regexp_replace(f."world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml'));--> statement-breakpoint
UPDATE "user_favorites" SET "world_ref" = regexp_replace("world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml') WHERE "world_ref" ~ '/api/v1/worlds/[^/.]+(/yaml)?$';--> statement-breakpoint
UPDATE "instances" SET "world_ref" = regexp_replace("world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml') WHERE "world_ref" ~ '/api/v1/worlds/[^/.]+(/yaml)?$';
