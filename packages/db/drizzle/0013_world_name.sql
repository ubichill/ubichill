-- 作者が付けた名前（metadata.name）。これまで本体は metadata.name を URL の ID（name）に書き換えて保存していたので、既存の行は同じ値で埋める
ALTER TABLE "worlds" ADD COLUMN "world_name" varchar(50);--> statement-breakpoint
UPDATE "worlds" SET "world_name" = COALESCE("definition"->'metadata'->>'name', "name");--> statement-breakpoint
ALTER TABLE "worlds" ALTER COLUMN "world_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "worlds_author_world_name_unique" ON "worlds" USING btree ("author_id","world_name");
--> statement-breakpoint
-- 保存済みの参照（お気に入り・インスタンス）を、公開の URL（.../api/v1/authors/<handle>/worlds/<name>.yaml）にそろえる。
-- 以前の形（.../api/v1/worlds/<id>、/yaml 付き、.yaml 付き、共有 URL .../world/<id>）が対象。
-- DB のワールドは作者の ID と名前で、DB に無い id はリポジトリの公式ワールド（作者 ubichill）として書き換える。
-- 作者が ID を持たない DB のワールドと、形の違う URL（外部ホストなど）はそのまま。
CREATE FUNCTION pg_temp.ubichill_world_ref(ref text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN s.wid IS NULL THEN ref
        ELSE COALESCE(
            (SELECT s.origin || '/api/v1/authors/' || u.handle || '/worlds/' || w.world_name || '.yaml'
               FROM worlds w JOIN users u ON u.id = w.author_id
              WHERE w.name = s.wid AND u.handle IS NOT NULL),
            CASE WHEN NOT EXISTS (SELECT 1 FROM worlds w WHERE w.name = s.wid)
                 THEN s.origin || '/api/v1/authors/ubichill/worlds/' || s.wid || '.yaml' END,
            ref)
    END
    FROM (SELECT substring(ref from '^https?://[^/]+/(?:api/v1/worlds|world)/([a-z0-9-]+)(?:/yaml|\.yaml)?$') AS wid,
                 substring(ref from '^(https?://[^/]+)') AS origin) s
$$;--> statement-breakpoint
-- 書き換えると同じになるお気に入りは、最初に登録した 1 件だけ残す（主キーの重複で UPDATE が止まらないように）
DELETE FROM "user_favorites" f USING (
    SELECT "user_id", "world_ref", ROW_NUMBER() OVER (
        PARTITION BY "user_id", pg_temp.ubichill_world_ref("world_ref")
        ORDER BY "created_at", "world_ref"
    ) AS rn
    FROM "user_favorites"
) d
WHERE f."user_id" = d."user_id" AND f."world_ref" = d."world_ref" AND d.rn > 1;--> statement-breakpoint
UPDATE "user_favorites" SET "world_ref" = pg_temp.ubichill_world_ref("world_ref") WHERE pg_temp.ubichill_world_ref("world_ref") <> "world_ref";--> statement-breakpoint
UPDATE "instances" SET "world_ref" = pg_temp.ubichill_world_ref("world_ref") WHERE pg_temp.ubichill_world_ref("world_ref") <> "world_ref";
