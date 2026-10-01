-- Fase 3 multitenant, PR 1: credenciales y webhooks.
--
-- 1. `key_version` en todo lo cifrado: la llave de cifrado se puede rotar
--    (src/server/credentials/maintenance.ts lo hace al arrancar).
-- 2. `webhook_secret` de Zernio (Instagram/Messenger) pasa a cifrarse: columnas
--    *_cipher/iv/tag. El arranque cifra lo que haya en claro y lo deja en NULL.
-- 3. H8: `whatsapp_business_account` — cada WABA es de UNA organización
--    (`waba_id` único) y `meta_credentials` cuelga de ella con FK compuesta.
--    Backfill desde `meta_credentials`.
-- 4. `webhook_unrouted` (PLATAFORMA, sin organización ni RLS): eventos de Meta
--    que no se pudieron enrutar, cifrados, 7 días.
-- 5. `ai_quota` y `ai_usage`: cuota mensual de IA por organización.
--
-- Las tablas de dominio nuevas llevan RLS forzado con la política de la 0027.
-- Idempotente: re-ejecutable sobre una base ya migrada.
-- Reversa SIN migración nueva: scripts/sql/0028-reversa.sql (ver docs/credenciales.md).

CREATE TABLE IF NOT EXISTS "ai_quota" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"monthly_turn_limit" integer,
	"monthly_token_limit" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_organization_id_period_kind_pk" PRIMARY KEY("organization_id","period","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_unrouted" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"route_kind" text NOT NULL,
	"route_key" text NOT NULL,
	"field" text,
	"reason" text DEFAULT 'unknown_route' NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_cipher" text NOT NULL,
	"payload_iv" text NOT NULL,
	"payload_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_business_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_business_account" ADD CONSTRAINT "whatsapp_business_account_org_waba_uq" UNIQUE("organization_id","waba_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
ALTER TABLE "capi_settings" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "google_credentials" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_tag" text;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret_tag" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "zoom_credentials" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_quota" ADD CONSTRAINT "ai_quota_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_business_account" ADD CONSTRAINT "whatsapp_business_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_unrouted_hash_uq" ON "webhook_unrouted" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_unrouted_received_idx" ON "webhook_unrouted" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_unrouted_route_idx" ON "webhook_unrouted" USING btree ("route_kind","route_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_business_account_waba_uq" ON "whatsapp_business_account" USING btree ("waba_id");--> statement-breakpoint
-- Backfill H8: una fila por cada WABA ya conectada. Si dos organizaciones
-- declararan la MISMA WABA (lo que H8 prohíbe desde ahora), la segunda no
-- entra y la FK de abajo FALLA a propósito: hay que decidir a mano de quién
-- es (consulta de solo lectura en docs/credenciales.md). Con una sola
-- organización no puede pasar.
INSERT INTO "whatsapp_business_account" ("id", "organization_id", "waba_id")
SELECT 'waba_' || substr(md5(mc."organization_id" || ':' || mc."waba_id"), 1, 21), mc."organization_id", mc."waba_id"
FROM "meta_credentials" mc
ON CONFLICT DO NOTHING;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "meta_credentials" ADD CONSTRAINT "meta_credentials_org_waba_fk" FOREIGN KEY ("organization_id","waba_id") REFERENCES "public"."whatsapp_business_account"("organization_id","waba_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_quota', 'ai_usage', 'whatsapp_business_account']
  LOOP
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
