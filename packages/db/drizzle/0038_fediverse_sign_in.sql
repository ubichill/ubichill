CREATE TABLE "external_account_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"software" text NOT NULL,
	"username" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fediverse_oauth_clients" (
	"origin" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fediverse_oauth_clients_origin_redirect_uri_pk" PRIMARY KEY("origin","redirect_uri")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "password_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_account_id" text;--> statement-breakpoint
ALTER TABLE "external_account_profiles" ADD CONSTRAINT "external_account_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_account_id_accounts_id_fk" FOREIGN KEY ("auth_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_auth_account_id_idx" ON "sessions" USING btree ("auth_account_id");--> statement-breakpoint
-- これまでのセッションはすべてパスワードでのログインで作られている（SSO はこの版から）
UPDATE "sessions" SET "password_verified_at" = "created_at" WHERE "password_verified_at" IS NULL;
