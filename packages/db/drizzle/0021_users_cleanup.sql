-- 画像は better-auth の image に寄せる。image に値がある行はそちらを正とし、空のときだけ profile_image_url を移す。
UPDATE "users" SET "image" = btrim("profile_image_url")
WHERE ("image" IS NULL OR btrim("image") = '') AND btrim(coalesce("profile_image_url", '')) <> '';--> statement-breakpoint
-- システムユーザー（worldRegistry の SYSTEM_AUTHOR_ID）は予約語の system にする（一般の登録では取れないので他人と重ならない）。
UPDATE "users" SET "handle" = 'system'
WHERE "id" = '00000000-0000-0000-0000-000000000000' AND "handle" IS NULL
	AND NOT EXISTS (SELECT 1 FROM "users" WHERE "handle" = 'system');--> statement-breakpoint
-- handle が無い既存ユーザーに `user_` + 乱数 12 桁（16 進）を振る。shared の handle の規則（[a-z0-9_]{3,30}・予約語でない）を
-- SQL だけで満たす形にし、メールや表示名から作らない（URL・署名の ID として公開されるため）。
-- 乱数は gen_random_uuid() の先頭 12 桁（48 bit）。既存の handle と重なれば引き直し、念のため回数に上限を置く。
DO $$
DECLARE
	target record;
	candidate text;
	attempts integer;
BEGIN
	FOR target IN SELECT "id" FROM "users" WHERE "handle" IS NULL ORDER BY "created_at", "id" LOOP
		attempts := 0;
		LOOP
			attempts := attempts + 1;
			IF attempts > 20 THEN
				RAISE EXCEPTION '0021_users_cleanup: % に重ならない handle を作れませんでした', target."id";
			END IF;
			candidate := 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
			EXIT WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE "handle" = candidate);
		END LOOP;
		UPDATE "users" SET "handle" = candidate, "updated_at" = now() WHERE "id" = target."id";
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "profile_image_url";
