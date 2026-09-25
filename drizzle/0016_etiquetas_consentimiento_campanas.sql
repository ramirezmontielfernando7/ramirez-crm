-- 021 - Etiquetas de contacto, consentimiento de WhatsApp y campanas.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas, columnas e indices, y bloques DO en las claves
-- foraneas.
--
-- Aditiva y segura con los datos que ya existen:
-- - Todo contacto existente queda con wa_consent = 'desconocido' (default):
--   nadie ha verificado su consentimiento, asi que ninguno entra a una
--   campana hasta que alguien lo marque opt_in.
-- - Las tablas nuevas nacen vacias.

CREATE TABLE IF NOT EXISTS "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"contact_name" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" text,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_tag_assignment" (
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tag_assignment_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_consent" text DEFAULT 'desconocido' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_consent_source" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_consent_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_tag_id_contact_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."contact_tag"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_org_created_idx" ON "campaign" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_status_idx" ON "campaign" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipient_campaign_contact_uq" ON "campaign_recipient" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_recipient_campaign_status_idx" ON "campaign_recipient" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_tag_org_name_uq" ON "contact_tag" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_tag_assignment_org_tag_idx" ON "contact_tag_assignment" USING btree ("organization_id","tag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_consent_idx" ON "contact" USING btree ("organization_id","wa_consent");