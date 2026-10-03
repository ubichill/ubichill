CREATE TABLE "world_name_aliases" (
	"author_id" text NOT NULL,
	"name" varchar(50) NOT NULL,
	"world_id" varchar(21) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_name_aliases_author_id_name_pk" PRIMARY KEY("author_id","name")
);
--> statement-breakpoint
ALTER TABLE "world_name_aliases" ADD CONSTRAINT "world_name_aliases_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_name_aliases" ADD CONSTRAINT "world_name_aliases_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;