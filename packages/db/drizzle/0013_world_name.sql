-- 作者が付けた名前（metadata.name）。これまで本体は metadata.name を URL の ID（name）に書き換えて保存していたので、既存の行は同じ値で埋める
ALTER TABLE "worlds" ADD COLUMN "world_name" varchar(50);--> statement-breakpoint
UPDATE "worlds" SET "world_name" = COALESCE("definition"->'metadata'->>'name', "name");--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "world_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "worlds_author_world_name_unique" ON "worlds" USING btree ("author_id","world_name");
--> statement-breakpoint
-- 本体のワールドの URL を、配信している YAML の URL（.../api/v1/worlds/<id>.yaml）にそろえる（外部ホストと同じ配り方）
-- 正規化すると同じになるお気に入り（/x と /x/yaml と x.yaml）は、最初に登録した 1 件だけ残す（主キーの重複で UPDATE が止まらないように）
DELETE FROM "user_favorites" f USING (
    SELECT "user_id", "world_ref", ROW_NUMBER() OVER (
        PARTITION BY "user_id", regexp_replace("world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml')
        ORDER BY "created_at", "world_ref"
    ) AS rn
    FROM "user_favorites"
) d
WHERE f."user_id" = d."user_id" AND f."world_ref" = d."world_ref" AND d.rn > 1;--> statement-breakpoint
UPDATE "user_favorites" SET "world_ref" = regexp_replace("world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml') WHERE "world_ref" ~ '/api/v1/worlds/[^/.]+(/yaml)?$';--> statement-breakpoint
UPDATE "instances" SET "world_ref" = regexp_replace("world_ref", '/api/v1/worlds/([^/.]+)(/yaml)?$', '/api/v1/worlds/\1.yaml') WHERE "world_ref" ~ '/api/v1/worlds/[^/.]+(/yaml)?$';
