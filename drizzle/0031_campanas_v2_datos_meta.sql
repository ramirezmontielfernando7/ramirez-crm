-- Campañas v2, PR 1 — Fundamentos de datos de Meta.
--
-- 1. `message`: hora de cada estado (sent/delivered/read/failed), código de
--    error numérico y el objeto `pricing` del webhook de estados.
-- 2. `template`: componentes completos, estado crudo de Meta (pausa,
--    desactivación), calidad, aviso de cambio de categoría (hecho o
--    próximo, con la categoría futura y su fecha) y la imagen del
--    encabezado guardada en el disco propio (FK compuesta a media_asset).
-- 3. `campaign_recipient.message_id` → `message` con FK compuesta: el estado
--    de entrega de cada destinatario se DERIVA del mensaje (sin duplicarlo).
--    Antes se ponen en NULL las referencias a mensajes que ya no existen
--    (el contacto se borró y su conversación se fue en cascada): sin eso la
--    FK no se puede validar. Es la única escritura de datos de la migración.
-- 4. `wa_phone_health` (historial diario de salud del número) y
--    `messaging_settings` (palabras de baja, respuesta automática, umbral de
--    alerta): tablas de dominio nuevas con RLS forzado (política de la 0027).
--
-- Todo es aditivo: el código anterior ignora lo nuevo, así que revertir es
-- volver a desplegar la imagen anterior. Limpieza opcional del esquema:
-- scripts/sql/revert-0031.sql.
--
-- Idempotente: re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "messaging_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"stop_keywords_enabled" boolean DEFAULT true NOT NULL,
	"stop_keywords" text[] NOT NULL,
	"stop_reply_enabled" boolean DEFAULT false NOT NULL,
	"stop_reply_text" text,
	"usage_alert_percent" integer DEFAULT 80 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_phone_health" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"day" date NOT NULL,
	"quality_rating" text,
	"messaging_limit" text,
	"messaging_limit_value" integer,
	"status" text,
	"throughput_level" text,
	"name_status" text,
	"account_event" jsonb,
	"source" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "read_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "error_code" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "pricing_billable" boolean;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "pricing_category" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "pricing_model" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "pricing_type" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "components" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "meta_status" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "paused_reason" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "quality_score" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "previous_category" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "category_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "category_change_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "upcoming_category" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "upcoming_category_at" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "header_media_asset_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_org_header_media_fk' AND conrelid = '"template"'::regclass) THEN
    ALTER TABLE "template" ADD CONSTRAINT "template_org_header_media_fk" FOREIGN KEY ("organization_id", "header_media_asset_id") REFERENCES "media_asset" ("organization_id", "id") ON DELETE SET NULL ("header_media_asset_id");
  END IF;
END
$$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "messaging_settings" ADD CONSTRAINT "messaging_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "messaging_settings" ADD CONSTRAINT "messaging_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "messaging_settings" ADD CONSTRAINT "messaging_settings_usage_alert_chk" CHECK ("usage_alert_percent" BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_phone_health" ADD CONSTRAINT "wa_phone_health_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_phone_health" ADD CONSTRAINT "wa_phone_health_source_chk" CHECK ("source" IN ('sync', 'manual', 'webhook'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_phone_health_org_phone_day_uq" ON "wa_phone_health" USING btree ("organization_id","phone_number_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_org_wa_template_idx" ON "template" USING btree ("organization_id","wa_template_id");--> statement-breakpoint
-- Destino de la FK compuesta: (organization_id, id) de message.
DO $$ BEGIN
	ALTER TABLE "message" ADD CONSTRAINT "message_org_id_uq" UNIQUE("organization_id","id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
-- Referencias colgantes (mensaje borrado con su conversación): a NULL.
UPDATE "campaign_recipient" cr SET "message_id" = NULL
WHERE cr."message_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "message" m
    WHERE m."organization_id" = cr."organization_id" AND m."id" = cr."message_id"
  );--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipient_org_message_fk' AND conrelid = '"campaign_recipient"'::regclass) THEN
    ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_org_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "message" ("organization_id", "id") ON DELETE SET NULL ("message_id") NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "campaign_recipient" VALIDATE CONSTRAINT "campaign_recipient_org_message_fk";--> statement-breakpoint
-- Índice para la FK (borrar un mensaje busca sus destinatarios).
CREATE INDEX IF NOT EXISTS "campaign_recipient_org_message_idx" ON "campaign_recipient" USING btree ("organization_id","message_id");--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messaging_settings', 'wa_phone_health'] LOOP
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
