CREATE TABLE "pending_registrations" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"handle" varchar(30) NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_registrations_email_idx" ON "pending_registrations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pending_registrations_expires_at_idx" ON "pending_registrations" USING btree ("expires_at");