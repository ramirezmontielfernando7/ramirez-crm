-- 020 - Roles (Propietario / Coordinador / Asesor) y asignacion de chats.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas, columnas e indices, y bloques DO en las claves
-- foraneas.
--
-- Segura con los datos que ya existen:
-- - Todo contacto queda SIN ASIGNAR (columna nueva nula). No se siembran
--   eventos de asignacion: no hubo ninguna que registrar.
-- - `owner` no se toca: el propietario sigue siendo propietario.
-- - El antiguo rol `member` veia TODA la bandeja. Pasarlo a `asesor` le
--   dejaria la bandeja vacia de golpe (nada esta asignado todavia), asi que
--   pasa a `coordinador`, que es lo mas parecido a lo que ya podia hacer. El
--   propietario lo baja a asesor desde Ajustes > Equipo cuando reparta.

CREATE TABLE IF NOT EXISTS "assignment_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"cursor_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_assignment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"lead_id" text,
	"from_user_id" text,
	"to_user_id" text,
	"actor_user_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"reason" text,
	"batch_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_team" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"coordinator_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'asesor';--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "assigned_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "sales_team_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_cursor_user_id_user_id_fk" FOREIGN KEY ("cursor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sales_team" ADD CONSTRAINT "sales_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sales_team" ADD CONSTRAINT "sales_team_coordinator_user_id_user_id_fk" FOREIGN KEY ("coordinator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cae_org_occurred_idx" ON "contact_assignment_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cae_contact_occurred_idx" ON "contact_assignment_event" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_team_org_idx" ON "sales_team" USING btree ("organization_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact" ADD CONSTRAINT "contact_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "member" ADD CONSTRAINT "member_sales_team_id_sales_team_id_fk" FOREIGN KEY ("sales_team_id") REFERENCES "public"."sales_team"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_assigned_idx" ON "contact" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
UPDATE "member" SET "role" = 'coordinador' WHERE "role" = 'member';
