-- 既存の値は UTC の時刻として入っている（drizzle は Date を toISOString() で書き、timestamp は末尾の Z を捨てる。
-- defaultNow() の now() はセッションの TimeZone で変換されるが、Bitnami / 公式イメージの既定は GMT / UTC）。
-- 前提が崩れている DB では変換せずに止める（initContainer の migrate が失敗し、古い Pod が動き続ける）。
-- defaultNow() の値はセッションの TimeZone で入るので、サーバー・この DB・このロールのどこかに UTC 以外の設定があれば UTC とみなせない
-- （pg_db_role_setting はクラスタ共有なので、ほかの DB・ロールの設定は除く）。
-- 過去に一時的に別の設定だった期間は検出できないので、本番では docs/operations/db-migration.md の事前確認も行う。
DO $$
DECLARE
	utc_names text[] := ARRAY['utc', 'gmt', 'etc/utc', 'etc/gmt', 'uct', 'etc/uct', 'universal', 'etc/universal', 'zulu', 'etc/zulu', 'greenwich', 'etc/greenwich', 'gmt0', 'etc/gmt0', 'gmt+0', 'gmt-0', 'etc/gmt+0', 'etc/gmt-0'];
	offending text;
BEGIN
	IF NOT lower(current_setting('TimeZone')) = ANY (utc_names) THEN
		RAISE EXCEPTION '0018_timestamptz: セッションの TimeZone が % のため、既存の timestamp を UTC として変換できません', current_setting('TimeZone');
	END IF;
	SELECT string_agg(c, ', ') INTO offending
	FROM pg_db_role_setting s, unnest(s.setconfig) AS c
	WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
		AND s.setrole IN (0, (SELECT oid FROM pg_roles WHERE rolname = current_user))
		AND lower(split_part(c, '=', 1)) = 'timezone'
		AND NOT lower(btrim(split_part(c, '=', 2), chr(39) || chr(34) || ' ')) = ANY (utc_names);
	IF offending IS NOT NULL THEN
		RAISE EXCEPTION '0018_timestamptz: DB またはロールに UTC 以外の TimeZone の設定があります（%）', offending;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "author_bindings"
	ALTER COLUMN "fetched_at" SET DATA TYPE timestamp with time zone USING "fetched_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "fetched_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "author_confirmed_contents"
	ALTER COLUMN "confirmed_at" SET DATA TYPE timestamp with time zone USING "confirmed_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "confirmed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "cli_auth_requests"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "external_works"
	ALTER COLUMN "registered_at" SET DATA TYPE timestamp with time zone USING "registered_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "registered_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "federation_peers"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "instances"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "publishing_environments"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "last_used_at" SET DATA TYPE timestamp with time zone USING "last_used_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "revoked_at" SET DATA TYPE timestamp with time zone USING "revoked_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "accounts"
	ALTER COLUMN "access_token_expires_at" SET DATA TYPE timestamp with time zone USING "access_token_expires_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "refresh_token_expires_at" SET DATA TYPE timestamp with time zone USING "refresh_token_expires_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "sessions"
	ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_favorites"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_friends"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_settings"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now(),
	ALTER COLUMN "display_name_changed_at" SET DATA TYPE timestamp with time zone USING "display_name_changed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "verifications"
	ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "world_name_aliases"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "worlds"
	ALTER COLUMN "draft_updated_at" SET DATA TYPE timestamp with time zone USING "draft_updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "updated_at" SET DEFAULT now();
