CREATE TABLE "federation_actor_keys" (
	"actor_id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"public_key_pem" text NOT NULL,
	"private_key_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_followers" (
	"user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"state" text NOT NULL,
	"follow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federation_followers_pk" PRIMARY KEY("user_id","actor_id"),
	CONSTRAINT "federation_followers_state_check" CHECK ("federation_followers"."state" IN ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "fediverse_manually_approves_followers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "fediverse_discoverable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_actor_keys" ADD CONSTRAINT "federation_actor_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_followers" ADD CONSTRAINT "federation_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_followers" ADD CONSTRAINT "federation_followers_actor_id_remote_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."remote_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_followers_actor_idx" ON "federation_followers" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "federation_followers_follow_idx" ON "federation_followers" USING btree ("follow_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('Follow', 'Accept', 'Like', 'Invite', 'Join', 'FediverseFollow', 'FediverseFollowRequest'));