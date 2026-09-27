CREATE TABLE "author_bindings" (
	"account" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"display_name" text,
	"confirmed_at" timestamp DEFAULT now() NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
