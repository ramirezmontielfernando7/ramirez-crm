-- Campañas v2, PR 3 — Métricas: analíticas de Meta copiadas a la base propia.
--
-- 1. `wa_template_analytics_daily`: enviados, entregados, leídos y clics por
--    plantilla y día (`template_analytics` de la WABA; Meta guarda 90 días).
-- 2. `wa_pricing_analytics_daily`: volumen y costo por día, número, país,
--    categoría y tipo (`pricing_analytics`; Meta guarda 1 año). Es lo
--    "Reportado por Meta" frente al costo "Estimado".
-- 3. `wa_analytics_sync`: estado de la última sincronización de cada una
--    (primera carga o diaria; "analíticas de plantillas no activas").
--
-- Las escribe SOLO la sincronización diaria (upsert por llave primaria);
-- ninguna pantalla consulta a Meta en vivo. Tablas de dominio con RLS
-- forzado (política de la 0027) e índices que empiezan por organización.
--
-- Solo aditiva: no toca tablas existentes ni escribe datos. El código
-- anterior ignora estas tablas, así que revertir es volver a desplegar la
-- imagen anterior. Limpieza opcional: scripts/sql/0033-reversa.sql.
--
-- Idempotente: re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "wa_analytics_sync" (
	"organization_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"synced_at" timestamp,
	CONSTRAINT "wa_analytics_sync_pk" PRIMARY KEY("organization_id","waba_id","kind"),
	CONSTRAINT "wa_analytics_sync_kind_chk" CHECK ("wa_analytics_sync"."kind" in ('template', 'pricing')),
	CONSTRAINT "wa_analytics_sync_status_chk" CHECK ("wa_analytics_sync"."status" in ('ok', 'not_enabled', 'error'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_pricing_analytics_daily" (
	"organization_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"day" date NOT NULL,
	"phone_number_id" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"pricing_category" text DEFAULT '' NOT NULL,
	"pricing_type" text DEFAULT '' NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"currency" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_pricing_analytics_daily_pk" PRIMARY KEY("organization_id","waba_id","day","phone_number_id","country","pricing_category","pricing_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_template_analytics_daily" (
	"organization_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"wa_template_id" text NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"clicked" integer DEFAULT 0 NOT NULL,
	"clicks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_template_analytics_daily_pk" PRIMARY KEY("organization_id","waba_id","wa_template_id","day")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_analytics_sync" ADD CONSTRAINT "wa_analytics_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_pricing_analytics_daily" ADD CONSTRAINT "wa_pricing_analytics_daily_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wa_template_analytics_daily" ADD CONSTRAINT "wa_template_analytics_daily_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_pricing_analytics_daily_org_day_idx" ON "wa_pricing_analytics_daily" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_template_analytics_daily_org_day_idx" ON "wa_template_analytics_daily" USING btree ("organization_id","day");--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_analytics_sync', 'wa_pricing_analytics_daily', 'wa_template_analytics_daily'] LOOP
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
