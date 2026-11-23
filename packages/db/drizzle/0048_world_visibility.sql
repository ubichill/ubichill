CREATE TYPE "public"."world_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "visibility" "world_visibility" DEFAULT 'public' NOT NULL;