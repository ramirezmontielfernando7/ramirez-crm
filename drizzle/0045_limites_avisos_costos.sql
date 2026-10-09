-- 036 (PR 3a) — Límites, plan, avisos de consumo, costos e historial.
--
-- `organization_plan`: plan («Personalizado», `plan_key = 'custom'`) y topes
-- propios que no viven en otra tabla: personas, almacenamiento (con su modo:
-- 'warn' solo avisa, 'block_uploads' rechaza las subidas desde el CRM que
-- pasarían el tope), módulos activos y tokens de embeddings. Los topes de IA
-- siguen en `ai_quota` y los de documentos en `kb_document_limit`.
-- `usage_alert`: avisos al 80 % y 100 % de cada tope, uno por organización,
-- mes, medida y umbral.
-- `platform_ai_pricing`: tabla de PLATAFORMA (sin organización, solo pool de
-- sistema) con los precios de IA en USD por millón de tokens y el tipo de
-- cambio, con historial (`valid_from`). La usa el panel de costos (PR 3b).
-- `ai_usage.cost_usd` / `ai_usage_agent.cost_usd`: costo real reportado por
-- el proveedor (PR 3b lo llena; 0 mientras tanto).
-- `org_usage_monthly`: cierre mensual de almacenamiento, personas y módulos
-- (lo llena el trabajo diario; historial en el PR 3c).
--
-- Tablas de dominio con RLS forzado (política de la 0027). Solo aditiva: el
-- código anterior ignora tablas y columnas nuevas. Limpieza opcional:
-- scripts/sql/0045-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada.
CREATE TABLE IF NOT EXISTS "org_usage_monthly" (
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_by_category" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files_without_size" integer DEFAULT 0 NOT NULL,
	"members" integer DEFAULT 0 NOT NULL,
	"active_modules" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_usage_monthly_organization_id_period_pk" PRIMARY KEY("organization_id","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_plan" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan_key" text DEFAULT 'custom' NOT NULL,
	"max_members" integer,
	"storage_limit_bytes" bigint,
	"storage_mode" text DEFAULT 'warn' NOT NULL,
	"max_active_modules" integer,
	"embed_token_limit" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "organization_plan_key_chk" CHECK ("organization_plan"."plan_key" in ('custom')),
	CONSTRAINT "organization_plan_storage_mode_chk" CHECK ("organization_plan"."storage_mode" in ('warn', 'block_uploads')),
	CONSTRAINT "organization_plan_max_members_chk" CHECK ("organization_plan"."max_members" is null or "organization_plan"."max_members" >= 0),
	CONSTRAINT "organization_plan_storage_chk" CHECK ("organization_plan"."storage_limit_bytes" is null or "organization_plan"."storage_limit_bytes" >= 0),
	CONSTRAINT "organization_plan_modules_chk" CHECK ("organization_plan"."max_active_modules" is null or "organization_plan"."max_active_modules" between 0 and 12),
	CONSTRAINT "organization_plan_embed_chk" CHECK ("organization_plan"."embed_token_limit" is null or "organization_plan"."embed_token_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_ai_pricing" (
	"id" text PRIMARY KEY NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"chat_input_usd_per_mtok" numeric(12, 6) NOT NULL,
	"chat_output_usd_per_mtok" numeric(12, 6) NOT NULL,
	"judge_input_usd_per_mtok" numeric(12, 6),
	"judge_output_usd_per_mtok" numeric(12, 6),
	"embed_usd_per_mtok" numeric(12, 6) DEFAULT '0' NOT NULL,
	"usd_to_local" numeric(14, 6) NOT NULL,
	"local_currency" text DEFAULT 'MXN' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_ai_pricing_currency_chk" CHECK ("platform_ai_pricing"."local_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "platform_ai_pricing_positive_chk" CHECK ("platform_ai_pricing"."chat_input_usd_per_mtok" >= 0 and "platform_ai_pricing"."chat_output_usd_per_mtok" >= 0 and "platform_ai_pricing"."embed_usd_per_mtok" >= 0 and "platform_ai_pricing"."usd_to_local" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_alert" (
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"threshold" integer NOT NULL,
	"used" bigint NOT NULL,
	"limit_value" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp,
	"seen_by" text,
	CONSTRAINT "usage_alert_organization_id_period_metric_threshold_pk" PRIMARY KEY("organization_id","period","metric","threshold"),
	CONSTRAINT "usage_alert_metric_chk" CHECK ("usage_alert"."metric" in ('ai_tokens', 'ai_turns', 'embed_tokens', 'storage', 'members', 'modules')),
	CONSTRAINT "usage_alert_threshold_chk" CHECK ("usage_alert"."threshold" in (80, 100))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_agent" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "org_usage_monthly" ADD CONSTRAINT "org_usage_monthly_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "platform_ai_pricing" ADD CONSTRAINT "platform_ai_pricing_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "usage_alert" ADD CONSTRAINT "usage_alert_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "usage_alert" ADD CONSTRAINT "usage_alert_seen_by_user_id_fk" FOREIGN KEY ("seen_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_ai_pricing_valid_from_idx" ON "platform_ai_pricing" USING btree ("valid_from");
--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_plan', 'usage_alert', 'org_usage_monthly'] LOOP
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
