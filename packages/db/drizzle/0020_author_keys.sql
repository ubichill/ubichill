CREATE TABLE "author_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"account" text,
	"algorithm" text NOT NULL,
	"public_key" text NOT NULL,
	"origin" text NOT NULL,
	"user_id" text,
	"kind" text,
	"name" text,
	"api_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "author_keys_api_token_hash_unique" UNIQUE("api_token_hash"),
	CONSTRAINT "author_keys_account_key_unique" UNIQUE("account","algorithm","public_key"),
	CONSTRAINT "author_keys_origin_check" CHECK ("author_keys"."origin" IN ('local', 'remote')),
	CONSTRAINT "author_keys_local_user_check" CHECK (("author_keys"."origin" = 'local') = ("author_keys"."user_id" IS NOT NULL)),
	CONSTRAINT "author_keys_remote_account_check" CHECK (("author_keys"."origin" = 'remote') = ("author_keys"."account" IS NOT NULL)),
	CONSTRAINT "author_keys_local_fields_check" CHECK ("author_keys"."origin" = 'remote' OR ("author_keys"."kind" IS NOT NULL AND "author_keys"."name" IS NOT NULL)),
	CONSTRAINT "author_keys_remote_fields_check" CHECK ("author_keys"."origin" = 'local' OR ("author_keys"."api_token_hash" IS NULL AND "author_keys"."revoke_reason" IS NULL)),
	CONSTRAINT "author_keys_revoke_reason_check" CHECK ("author_keys"."revoke_reason" IS NULL OR "author_keys"."revoke_reason" IN ('lost', 'compromised')),
	CONSTRAINT "author_keys_public_key_check" CHECK ("author_keys"."algorithm" = 'ed25519' AND "author_keys"."public_key" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$')
);
--> statement-breakpoint
CREATE TABLE "remote_authors" (
	"account" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "author_keys" ADD CONSTRAINT "author_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "author_keys_local_key_unique" ON "author_keys" USING btree ("algorithm","public_key") WHERE "author_keys"."origin" = 'local';--> statement-breakpoint
CREATE INDEX "author_keys_user_id_idx" ON "author_keys" USING btree ("user_id");--> statement-breakpoint
-- ここから既存のデータを移す（publishing_environments・author_bindings は残し、次のマイグレーションで消す）。
-- 公開鍵の正規化は shared の normalizeEd25519PublicKey と同じ規則（`ed25519:` の接頭辞を外し、base64 / base64url・
-- パディングの有無を受け、43 文字目の下位 2 bit を 0 にした base64url）。decode は余りの bit を捨てるので、
-- decode → encode で正規形になる。形が合わなければ NULL。
CREATE FUNCTION pg_temp.ubichill_normalize_ed25519(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN body ~ '^[A-Za-z0-9+/_-]{43}=?$' THEN
		rtrim(translate(encode(decode(translate(rtrim(body, '='), '-_', '+/') || '=', 'base64'), 'base64'), '+/', '-_'), '=')
	END
	FROM (SELECT regexp_replace(value, '^ed25519:', '') AS body) AS s
$$;--> statement-breakpoint
CREATE FUNCTION pg_temp.ubichill_try_timestamptz(value text) RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
	RETURN value::timestamptz;
EXCEPTION WHEN others THEN
	RETURN NULL;
END
$$;--> statement-breakpoint
-- 自サーバーの鍵は正なので、読めない鍵や、正規化すると重なる鍵（同じ鍵の別の書き方）があれば黙って捨てずに止める
-- （どちらのアカウントの鍵かは人が決める。docs/operations/db-migration.md の事前確認）。
DO $$
DECLARE
	invalid text;
	duplicated text;
BEGIN
	SELECT string_agg("id", ', ') INTO invalid
	FROM "publishing_environments" WHERE pg_temp.ubichill_normalize_ed25519("public_key") IS NULL;
	IF invalid IS NOT NULL THEN
		RAISE EXCEPTION '0020_author_keys: 公開鍵の形が読めない公開環境があります（%）', invalid;
	END IF;
	SELECT string_agg(ids, '; ') INTO duplicated FROM (
		SELECT string_agg("id", ', ') AS ids
		FROM "publishing_environments"
		GROUP BY pg_temp.ubichill_normalize_ed25519("public_key")
		HAVING count(*) > 1
	) AS d;
	IF duplicated IS NOT NULL THEN
		RAISE EXCEPTION '0020_author_keys: 同じ鍵を別の書き方で登録した公開環境があります（%）', duplicated;
	END IF;
END $$;--> statement-breakpoint
-- id は公開環境の id をそのまま使う（取り消しの API・CLI の whoami が id で指す）。account は持たない（user_id から引く）
INSERT INTO "author_keys" (
	"id", "account", "algorithm", "public_key", "origin", "user_id", "kind", "name", "api_token_hash",
	"created_at", "last_used_at", "revoked_at", "revoke_reason"
)
SELECT
	"id", NULL, 'ed25519', pg_temp.ubichill_normalize_ed25519("public_key"), 'local', "user_id", "kind", "name",
	"api_token_hash", "created_at", "last_used_at", "revoked_at", "revoke_reason"
FROM "publishing_environments";--> statement-breakpoint
INSERT INTO "remote_authors" ("account", "display_name", "fetched_at")
SELECT "account", "display_name", "fetched_at" FROM "author_bindings";--> statement-breakpoint
-- 他サーバーの鍵は取り直せるキャッシュなので、読めない鍵は捨てる（署名の鍵は検証で形を確かめるので、もともと一致しない）。
-- 正規化して重なる鍵は 1 行にまとめ、どれか 1 つでも取り消されていれば取り消し（shared の signingKeyStatus と同じ）。
-- 取り消しの時刻が読めなければ、取り消しとして確認時刻を入れる（読めないことで有効に戻さない）。
INSERT INTO "author_keys" (
	"id", "account", "algorithm", "public_key", "origin", "created_at", "fetched_at", "revoked_at"
)
SELECT
	gen_random_uuid()::text, k."account", 'ed25519', k."public_key", 'remote',
	COALESCE(min(k."added_at"), k."fetched_at"), k."fetched_at", min(k."revoked_at")
FROM (
	SELECT
		b."account",
		b."fetched_at",
		pg_temp.ubichill_normalize_ed25519(e ->> 'publicKey') AS "public_key",
		pg_temp.ubichill_try_timestamptz(e ->> 'addedAt') AS "added_at",
		CASE WHEN e -> 'revokedAt' IS NULL OR e -> 'revokedAt' = 'null'::jsonb THEN NULL
			ELSE COALESCE(pg_temp.ubichill_try_timestamptz(e ->> 'revokedAt'), b."fetched_at") END AS "revoked_at"
	FROM "author_bindings" AS b,
		jsonb_array_elements(CASE WHEN jsonb_typeof(b."keys") = 'array' THEN b."keys" ELSE '[]'::jsonb END) AS e
) AS k
WHERE k."public_key" IS NOT NULL
GROUP BY k."account", k."public_key", k."fetched_at";--> statement-breakpoint
DROP FUNCTION pg_temp.ubichill_normalize_ed25519(text);--> statement-breakpoint
DROP FUNCTION pg_temp.ubichill_try_timestamptz(text);