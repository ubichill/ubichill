CREATE TABLE "world_assets" (
	"owner_id" text NOT NULL,
	"hash" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_assets_owner_id_hash_pk" PRIMARY KEY("owner_id","hash")
);
--> statement-breakpoint
ALTER TABLE "world_assets" ADD CONSTRAINT "world_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_assets_hash_idx" ON "world_assets" USING btree ("hash");