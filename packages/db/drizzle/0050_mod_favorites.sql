CREATE TABLE "user_mod_favorites" (
	"user_id" text NOT NULL,
	"author" text NOT NULL,
	"mod_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mod_favorites_user_id_author_mod_id_pk" PRIMARY KEY("user_id","author","mod_id")
);
--> statement-breakpoint
ALTER TABLE "user_mod_favorites" ADD CONSTRAINT "user_mod_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;