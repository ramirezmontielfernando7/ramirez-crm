-- 038 (PR 1) — Base del asistente interno: módulo premium, tope propio,
-- visibilidad del consumo para el cliente y sus conversaciones.
--
-- `organization_module.asistente`: el 13.º interruptor de /platform, DEFAULT
-- false (ninguna organización existente lo trae encendido).
-- `ai_quota.assistant_monthly_token_limit`: tope propio del asistente (tokens
-- al mes); también cuenta en el total. NULL = el del entorno o, sin él, el
-- asistente no responde.
-- `organization_plan.usage_visibility`: cómo ve el cliente su consumo de IA
-- ('percent' por defecto, 'status' o 'tokens'). Nunca ve dólares.
-- `organization_plan_modules_chk` pasa de 0–12 a 0–13 y `usage_alert_metric_chk`
-- admite 'assistant_tokens': las dos solo AMPLÍAN lo permitido (ninguna fila
-- existente deja de cumplir).
-- `user_preference.assistant_notice_accepted_at`: cuándo aceptó cada persona
-- el aviso de consumo del asistente.
-- `assistant_thread` / `assistant_message`: conversaciones del asistente (las
-- escribe el motor del PR 2), con RLS forzado (política de la 0027).
--
-- Solo aditiva: el código anterior ignora tablas y columnas nuevas.
-- Limpieza opcional: scripts/sql/0047-reversa.sql. Idempotente:
-- re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "assistant_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_thread_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "assistant_thread_title_chk" CHECK ("assistant_thread"."title" is null or char_length("assistant_thread"."title") <= 200)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_message_role_chk" CHECK ("assistant_message"."role" in ('user', 'assistant')),
	CONSTRAINT "assistant_message_content_chk" CHECK (char_length("assistant_message"."content") <= 20000)
);
--> statement-breakpoint
ALTER TABLE "ai_quota" ADD COLUMN IF NOT EXISTS "assistant_monthly_token_limit" integer;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "asistente" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_plan" ADD COLUMN IF NOT EXISTS "usage_visibility" text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN IF NOT EXISTS "assistant_notice_accepted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_org_thread_fk" FOREIGN KEY ("organization_id","thread_id") REFERENCES "public"."assistant_thread"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_thread" ADD CONSTRAINT "assistant_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_thread" ADD CONSTRAINT "assistant_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_message_org_thread_idx" ON "assistant_message" USING btree ("organization_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_thread_org_user_idx" ON "assistant_thread" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_quota" ADD CONSTRAINT "ai_quota_assistant_tokens_chk" CHECK ("ai_quota"."assistant_monthly_token_limit" is null or "ai_quota"."assistant_monthly_token_limit" >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_usage_visibility_chk" CHECK ("organization_plan"."usage_visibility" in ('status', 'percent', 'tokens'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Ampliar dos CHECK: quitar y volver a poner (re-ejecutable).
ALTER TABLE "organization_plan" DROP CONSTRAINT IF EXISTS "organization_plan_modules_chk";--> statement-breakpoint
ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_modules_chk" CHECK ("organization_plan"."max_active_modules" is null or "organization_plan"."max_active_modules" between 0 and 13);--> statement-breakpoint
ALTER TABLE "usage_alert" DROP CONSTRAINT IF EXISTS "usage_alert_metric_chk";--> statement-breakpoint
ALTER TABLE "usage_alert" ADD CONSTRAINT "usage_alert_metric_chk" CHECK ("usage_alert"."metric" in ('ai_tokens', 'ai_turns', 'embed_tokens', 'storage', 'members', 'modules', 'assistant_tokens'));--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_thread', 'assistant_message'] LOOP
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
