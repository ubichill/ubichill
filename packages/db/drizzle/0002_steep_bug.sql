CREATE TABLE "federation_peers" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "federation_peers_base_url_unique" UNIQUE("base_url")
);
