-- Fase 3, PR 3 — Módulos por organización y organización madre.
--
-- 1. `organization_module`: qué módulos opcionales tiene cada organización
--    (antes, las banderas de despliegue CAMPAIGNS, AGENDA, ATRIBUCION y
--    CHANNELS). Tabla de dominio: RLS forzado con la política de la 0027.
--    La migración NO siembra filas: no puede leer las variables de entorno.
--    El arranque (src/server/modules/backfill.ts) inserta, solo para las
--    organizaciones sin fila, lo que el entorno tiene encendido hoy; sin fila
--    también valen las variables, así que nada cambia entre migrar y arrancar.
-- 2. `organization.parent_id`: nulo, para la futura reventa por agencias.
--    Nada lo usa todavía.
--
-- Idempotente: re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "organization_module" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"campaigns" boolean DEFAULT false NOT NULL,
	"agenda" boolean DEFAULT false NOT NULL,
	"atribucion" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"campaign_send_rate" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "parent_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization" ADD CONSTRAINT "organization_parent_id_organization_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization" ADD CONSTRAINT "organization_parent_not_self_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_send_rate_chk" CHECK ("campaign_send_rate" IS NULL OR "campaign_send_rate" BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_channels_chk" CHECK ("channels" <@ ARRAY['instagram', 'messenger']::text[]);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_parent_idx" ON "organization" USING btree ("parent_id");--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
DO $$
BEGIN
  ALTER TABLE "organization_module" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "organization_module" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS aislamiento_por_organizacion ON "organization_module";
  CREATE POLICY aislamiento_por_organizacion ON "organization_module"
    USING (organization_id = current_setting('app.org_id', true))
    WITH CHECK (organization_id = current_setting('app.org_id', true));
END
$$;
