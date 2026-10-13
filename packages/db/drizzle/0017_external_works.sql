CREATE TABLE "external_works" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_works_user_id_kind_url_name_pk" PRIMARY KEY("user_id","kind","url","name")
);
--> statement-breakpoint
ALTER TABLE "external_works" ADD CONSTRAINT "external_works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_works_user_id_idx" ON "external_works" USING btree ("user_id");