ALTER TABLE "instances" DROP CONSTRAINT "instances_world_id_worlds_id_fk";
--> statement-breakpoint
ALTER TABLE "user_favorites" DROP CONSTRAINT "user_favorites_world_id_worlds_id_fk";
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "world_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD COLUMN "world_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_favorites" DROP CONSTRAINT "user_favorites_user_id_world_id_pk";--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_world_ref_pk" PRIMARY KEY("user_id","world_ref");--> statement-breakpoint
CREATE INDEX "instances_world_ref_idx" ON "instances" USING btree ("world_ref");--> statement-breakpoint
CREATE INDEX "instances_status_idx" ON "instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "instances_leader_id_idx" ON "instances" USING btree ("leader_id");--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "world_id";--> statement-breakpoint
ALTER TABLE "user_favorites" DROP COLUMN "world_id";
