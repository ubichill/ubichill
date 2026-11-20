CREATE TABLE "retired_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" varchar(30) NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retired_accounts_handle_unique" UNIQUE("handle")
);
