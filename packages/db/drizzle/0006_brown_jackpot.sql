ALTER TABLE "users" ADD COLUMN "display_name_key" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_key_unique" UNIQUE("display_name_key");--> statement-breakpoint
-- 既存ユーザーの表示名キーを埋める（shared の displayNameKey と同じ規則）。他人と重複する表示名は
-- どちらも null のままにし、プロフィールで表示名の変更を促す（どちらかを勝手に優先しない）。
UPDATE "users" AS u SET "display_name_key" = k.key
FROM (
    SELECT id, lower(regexp_replace(btrim(normalize("name", NFKC)), '\s+', ' ', 'g')) AS key FROM "users"
) AS k
WHERE u.id = k.id
  AND (SELECT count(*) FROM "users" AS o
       WHERE lower(regexp_replace(btrim(normalize(o."name", NFKC)), '\s+', ' ', 'g')) = k.key) = 1;
