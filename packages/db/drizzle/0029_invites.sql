CREATE TABLE "instance_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" varchar(21) NOT NULL,
	"inviter_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_requests" (
	"requester_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invite_requests_pk" PRIMARY KEY("requester_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_invites" ADD CONSTRAINT "instance_invites_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_invites" ADD CONSTRAINT "instance_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_invites" ADD CONSTRAINT "instance_invites_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_requests" ADD CONSTRAINT "invite_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_requests" ADD CONSTRAINT "invite_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instance_invites_instance_invitee_idx" ON "instance_invites" USING btree ("instance_id","invitee_id");--> statement-breakpoint
CREATE INDEX "instance_invites_invitee_idx" ON "instance_invites" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "instance_invites_expires_idx" ON "instance_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invite_requests_target_idx" ON "invite_requests" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "invite_requests_expires_idx" ON "invite_requests" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('Follow', 'Accept', 'Like', 'Invite', 'Join'));