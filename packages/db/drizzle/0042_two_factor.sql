CREATE TABLE "two_factor_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"password_verified" boolean NOT NULL,
	"auth_account_id" text,
	"remember" boolean NOT NULL,
	"return_to" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_two_factors" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_used_step" bigint,
	"backup_code_hashes" text[] DEFAULT '{}' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_auth_account_id_accounts_id_fk" FOREIGN KEY ("auth_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD CONSTRAINT "user_two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factor_challenges_expires_at_idx" ON "two_factor_challenges" USING btree ("expires_at");