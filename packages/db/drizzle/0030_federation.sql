CREATE TABLE "domain_policies" (
	"domain" text PRIMARY KEY NOT NULL,
	"policy" text NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_policies_policy_check" CHECK ("domain_policies"."policy" IN ('limit', 'block'))
);
--> statement-breakpoint
CREATE TABLE "federated_admissions" (
	"instance_id" varchar(21) NOT NULL,
	"actor_id" text NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federated_admissions_pk" PRIMARY KEY("instance_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "federation_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_user_id" text,
	"inbox" text NOT NULL,
	"host" text NOT NULL,
	"body" jsonb NOT NULL,
	"order_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_seen" (
	"key" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remote_actors" (
	"id" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"domain" text NOT NULL,
	"type" text DEFAULT 'Person' NOT NULL,
	"name" text,
	"summary" text,
	"icon" text,
	"url" text,
	"inbox" text NOT NULL,
	"shared_inbox" text,
	"keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_actors_account_unique" UNIQUE("account")
);
--> statement-breakpoint
CREATE TABLE "remote_friendships" (
	"user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"state" text NOT NULL,
	"offer_id" text NOT NULL,
	"relationship_id" text NOT NULL,
	"accept_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_friendships_pk" PRIMARY KEY("user_id","actor_id"),
	CONSTRAINT "remote_friendships_state_check" CHECK ("remote_friendships"."state" IN ('outgoing', 'incoming', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "remote_servers" (
	"domain" text PRIMARY KEY NOT NULL,
	"software" text,
	"version" text,
	"federation_version" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone,
	"node_info_fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "remote_visits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"room_url" text NOT NULL,
	"room" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_invites" DROP CONSTRAINT "instance_invites_inviter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "instance_invites" DROP CONSTRAINT "instance_invites_invitee_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invite_requests" DROP CONSTRAINT "invite_requests_requester_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invite_requests" DROP CONSTRAINT "invite_requests_target_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invite_requests" ADD COLUMN "activity_id" text;--> statement-breakpoint
ALTER TABLE "domain_policies" ADD CONSTRAINT "domain_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federated_admissions" ADD CONSTRAINT "federated_admissions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_deliveries" ADD CONSTRAINT "federation_deliveries_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_friendships" ADD CONSTRAINT "remote_friendships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_friendships" ADD CONSTRAINT "remote_friendships_actor_id_remote_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."remote_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_visits" ADD CONSTRAINT "remote_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_deliveries_due_idx" ON "federation_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "federation_deliveries_order_idx" ON "federation_deliveries" USING btree ("order_key","created_at");--> statement-breakpoint
CREATE INDEX "federation_deliveries_host_idx" ON "federation_deliveries" USING btree ("host");--> statement-breakpoint
CREATE INDEX "federation_seen_expires_idx" ON "federation_seen" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "remote_actors_domain_idx" ON "remote_actors" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "remote_friendships_actor_idx" ON "remote_friendships" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "remote_friendships_offer_idx" ON "remote_friendships" USING btree ("offer_id");