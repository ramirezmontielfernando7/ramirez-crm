-- 026 - Participantes en chats de WhatsApp (y menciones de chats de cliente
-- en el chat de equipo, que usan la columna `team_chat_message.mentions` ya
-- creada en 0020: no necesitan tabla).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas e indices y bloques DO en las claves foraneas.
--
-- Aditiva: dos tablas nuevas que nacen vacias. contact.assigned_user_id no se
-- toca: sigue siendo la unica fuente de verdad de la asignacion principal.

CREATE TABLE IF NOT EXISTS "contact_participant" (
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_participant_contact_id_user_id_pk" PRIMARY KEY("contact_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_participant_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"actor_user_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_participant_org_user_idx" ON "contact_participant" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cpe_contact_occurred_idx" ON "contact_participant_event" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cpe_org_occurred_idx" ON "contact_participant_event" USING btree ("organization_id","occurred_at");