-- Campañas v2, PR 2 — Audiencias, envío por número y pausa de seguridad.
--
-- 1. `contact.email`: correo OPCIONAL (solo atributo; Vocero no envía
--    correos), no único, con índice (organización, lower(email)).
-- 2. `audience_import` + `audience_member`: las bases subidas (.xlsx/.csv)
--    desde Campañas → Audiencias, sus miembros y los valores de sus columnas
--    extra (sirven como variables de la plantilla).
-- 3. `campaign`: programación, número que envía, pausa (a mano o
--    automática, con motivo y hora de reintento), costo ESTIMADO, excluidos
--    por motivo y última prueba.
-- 4. `campaign_recipient`: reclamo atómico (claimed_at/claimed_by), intentos
--    y espera ante errores transitorios, variables resueltas y código de
--    error. Los estados nuevos (`sending`, `skipped`) son texto: sin CHECK.
-- 5. `campaign_settings` (umbrales de la pausa de seguridad, tarifas
--    estimadas que captura el negocio, ventana de respuestas) y
--    `wa_send_lease` (qué réplica despacha cada número). Tablas de dominio
--    con RLS forzado (política de la 0027).
--
-- Sin escrituras de datos: todo es aditivo y con default. El código anterior
-- ignora lo nuevo y solo reanuda campañas en `sending`, así que revertir es
-- volver a desplegar la imagen anterior. Limpieza opcional del esquema:
-- scripts/sql/0032-reversa.sql.
--
-- Idempotente: re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "audience_import" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"file_kind" text NOT NULL,
	"tag_id" text,
	"consent_source" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audience_member" (
	"organization_id" text NOT NULL,
	"import_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"fail_rate_percent" integer DEFAULT 20 NOT NULL,
	"fail_rate_window" integer DEFAULT 50 NOT NULL,
	"pause_on_quality_red" boolean DEFAULT true NOT NULL,
	"usage_pause_percent" integer DEFAULT 95 NOT NULL,
	"rates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text,
	"reply_window_hours" integer DEFAULT 72 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_send_lease" (
	"organization_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"owner" text NOT NULL,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "phone_number_id" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "pause_reason" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "auto_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "resume_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "estimated_cost" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "cost_currency" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "excluded" jsonb;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "test_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "claimed_by" text;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "variables" jsonb;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN IF NOT EXISTS "error_code" integer;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_import" ADD CONSTRAINT "audience_import_org_id_uq" UNIQUE("organization_id","id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_import" ADD CONSTRAINT "audience_import_file_kind_chk" CHECK ("file_kind" in ('csv', 'xlsx'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_member" ADD CONSTRAINT "audience_member_pk" PRIMARY KEY("organization_id","import_id","contact_id");
EXCEPTION WHEN invalid_table_definition OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_send_lease" ADD CONSTRAINT "wa_send_lease_pk" PRIMARY KEY("organization_id","phone_number_id");
EXCEPTION WHEN invalid_table_definition OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_fail_rate_chk" CHECK ("fail_rate_percent" between 1 and 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_fail_window_chk" CHECK ("fail_rate_window" between 10 and 1000);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_usage_pause_chk" CHECK ("usage_pause_percent" between 1 and 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_reply_window_chk" CHECK ("reply_window_hours" between 1 and 720);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_import" ADD CONSTRAINT "audience_import_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_import" ADD CONSTRAINT "audience_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Borrar la etiqueta no borra la base: solo suelta tag_id (PG15+).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audience_import_org_tag_fk' AND conrelid = '"audience_import"'::regclass) THEN
    ALTER TABLE "audience_import" ADD CONSTRAINT "audience_import_org_tag_fk" FOREIGN KEY ("organization_id", "tag_id") REFERENCES "contact_tag" ("organization_id", "id") ON DELETE SET NULL ("tag_id");
  END IF;
END
$$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_member" ADD CONSTRAINT "audience_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_member" ADD CONSTRAINT "audience_member_org_import_fk" FOREIGN KEY ("organization_id","import_id") REFERENCES "public"."audience_import"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audience_member" ADD CONSTRAINT "audience_member_org_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contact"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_send_lease" ADD CONSTRAINT "wa_send_lease_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audience_import_org_created_idx" ON "audience_import" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audience_member_org_contact_idx" ON "audience_member" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_email_idx" ON "contact" USING btree ("organization_id",lower("email"));--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audience_import', 'audience_member', 'campaign_settings', 'wa_send_lease'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_por_organizacion ON %I', t);
    EXECUTE format(
      'CREATE POLICY aislamiento_por_organizacion ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t
    );
  END LOOP;
END
$$;
