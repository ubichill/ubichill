CREATE TABLE "cli_auth_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"redirect_uri" text,
	"code_challenge" text,
	"user_code" text,
	"device_code_hash" text,
	"auth_code_hash" text,
	"user_id" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "cli_auth_requests_user_code_unique" UNIQUE("user_code"),
	CONSTRAINT "cli_auth_requests_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "cli_auth_requests_auth_code_hash_unique" UNIQUE("auth_code_hash")
);
--> statement-breakpoint
ALTER TABLE "cli_auth_requests" ADD CONSTRAINT "cli_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;