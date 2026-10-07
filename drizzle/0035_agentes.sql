-- 031, PR A1 — Laboratorio como Centro de Agentes: varios agentes por
-- organización, con borrador y publicado.
--
-- 1. `agent`: una fila por agente, incluido el GENERAL (máx. uno no archivado
--    por organización: índice único parcial `agent_general_uq`). `draft` y
--    `published` son JSON con la forma de `agentConfigSchema`.
-- 2. `agent_publish_log`: versiones publicadas (append-only: un disparador
--    rechaza UPDATE; el recorte a las últimas 30 y la purga borran).
-- 3. `kb_entry.agent_id`: NULL = conocimiento compartido (todo lo de hoy).
-- 4. `agent_test_run.agent_id` + `agent_snapshot`: qué se evaluó, tal cual.
-- 5. Backfill: cada organización con `agent_profile` recibe su agente general
--    con `draft = published = ` su perfil de hoy (mismo nombre, mismo texto)
--    y `published_at = agent_profile.updated_at` (el espejo queda al día).
--
-- Solo aditiva: el código anterior ignora tablas y columnas nuevas, así que
-- revertir es volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0035-reversa.sql. Idempotente: re-ejecutable sobre una base
-- ya migrada. Tablas de dominio con RLS forzado (política de la 0027).
CREATE TABLE IF NOT EXISTS "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"is_general" boolean DEFAULT false NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp,
	"published_by" text,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "agent_internal_name_chk" CHECK (char_length("agent"."internal_name") between 1 and 60),
	CONSTRAINT "agent_draft_chk" CHECK (jsonb_typeof("agent"."draft") = 'object'),
	CONSTRAINT "agent_published_chk" CHECK ("agent"."published" is null or jsonb_typeof("agent"."published") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_publish_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_user_id" text,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_publish_log_action_chk" CHECK ("agent_publish_log"."action" in ('publish', 'restore', 'legacy_put', 'make_general')),
	CONSTRAINT "agent_publish_log_snapshot_chk" CHECK (jsonb_typeof("agent_publish_log"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN IF NOT EXISTS "agent_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent" ADD CONSTRAINT "agent_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_publish_log" ADD CONSTRAINT "agent_publish_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_publish_log" ADD CONSTRAINT "agent_publish_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_publish_log" ADD CONSTRAINT "agent_publish_log_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- SET NULL solo de agent_id (Postgres 15+): la corrida sobrevive al agente.
DO $$ BEGIN
	ALTER TABLE "agent_test_run" ADD CONSTRAINT "agent_test_run_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE SET NULL ("agent_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_entry" ADD CONSTRAINT "kb_entry_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_general_uq" ON "agent" USING btree ("organization_id") WHERE "agent"."is_general" and "agent"."archived_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_org_idx" ON "agent" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_publish_log_agent_at_idx" ON "agent_publish_log" USING btree ("organization_id","agent_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_org_agent_idx" ON "kb_entry" USING btree ("organization_id","agent_id");--> statement-breakpoint
-- Bitácora append-only: ninguna fila se reescribe. Única excepción: el
-- `ON DELETE SET NULL` de `actor_user_id` cuando se borra a la persona.
-- DELETE no se bloquea: el recorte a 30 versiones y la purga lo usan.
CREATE OR REPLACE FUNCTION agent_publish_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_user_id IS NULL
    AND (NEW.id, NEW.organization_id, NEW.agent_id, NEW.action, NEW.snapshot, NEW.at)
      IS NOT DISTINCT FROM (OLD.id, OLD.organization_id, OLD.agent_id, OLD.action, OLD.snapshot, OLD.at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'agent_publish_log es append-only';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS agent_publish_log_no_update ON "agent_publish_log";--> statement-breakpoint
CREATE TRIGGER agent_publish_log_no_update BEFORE UPDATE ON "agent_publish_log"
  FOR EACH ROW EXECUTE FUNCTION agent_publish_log_append_only();--> statement-breakpoint
-- Backfill del agente general (id determinista: re-ejecutar no duplica).
INSERT INTO "agent" ("id", "organization_id", "internal_name", "is_general", "draft", "published", "published_at", "created_at", "updated_at")
SELECT
  'agt_' || substr(md5(p."organization_id" || ':general'), 1, 20),
  p."organization_id",
  'Agente principal',
  true,
  jsonb_build_object('v', 1, 'displayName', p."name", 'tone', p."tone", 'greeting', p."greeting",
    'instructions', p."instructions", 'escalationRules', p."escalation_rules", 'useSharedKb', true),
  jsonb_build_object('v', 1, 'displayName', p."name", 'tone', p."tone", 'greeting', p."greeting",
    'instructions', p."instructions", 'escalationRules', p."escalation_rules", 'useSharedKb', true),
  p."updated_at",
  now(),
  now()
FROM "agent_profile" p
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent', 'agent_publish_log'] LOOP
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
