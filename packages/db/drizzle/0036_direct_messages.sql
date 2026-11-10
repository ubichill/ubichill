CREATE TABLE "direct_message_reactions" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_message_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id"),
	CONSTRAINT "direct_message_reactions_emoji_check" CHECK (char_length("direct_message_reactions"."emoji") BETWEEN 1 AND 32)
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "direct_messages_not_self_check" CHECK ("direct_messages"."sender_id" <> "direct_messages"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_message_id_direct_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."direct_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_messages_pair_created_idx" ON "direct_messages" USING btree ("sender_id","recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "direct_messages_recipient_created_idx" ON "direct_messages" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "direct_messages_unread_idx" ON "direct_messages" USING btree ("recipient_id","sender_id") WHERE "direct_messages"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "direct_messages_created_at_idx" ON "direct_messages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('Follow', 'Accept', 'Like', 'Invite', 'Join', 'FediverseFollow', 'FediverseFollowRequest', 'Create', 'EmojiReact'));