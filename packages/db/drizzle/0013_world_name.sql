-- 作者が付けた名前（metadata.name）。これまで本体は metadata.name を URL の ID（name）に書き換えて保存していたので、既存の行は同じ値で埋める
ALTER TABLE "worlds" ADD COLUMN "world_name" varchar(50);--> statement-breakpoint
UPDATE "worlds" SET "world_name" = COALESCE("definition"->'metadata'->>'name', "name");--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "world_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "worlds_author_world_name_unique" ON "worlds" USING btree ("author_id","world_name");
