-- Campañas v2, PR 4 — Registro de módulos y navegación personalizable.
--
-- 1. `organization_module` recibe los módulos que antes eran de TODAS las
--    organizaciones: knowledge, lab, agent, team_chat y results, con
--    DEFAULT true (migrar no le apaga nada a nadie), y `custom_nav` con
--    DEFAULT false (la personalización del menú la enciende la plataforma).
--    El Laboratorio requiere al Agente (CHECK).
-- 2. `nav_layout`: el menú de un rol en una organización (Ajustes →
--    Navegación). Solo estético: permisos y módulos se validan en el servidor.
-- 3. `nav_layout_event`: bitácora append-only de esos cambios (un disparador
--    rechaza UPDATE; el borrado solo llega en cascada al purgar la
--    organización).
--
-- Tablas de dominio con RLS forzado (política de la 0027). Solo aditiva:
-- el código anterior ignora las columnas y tablas nuevas, así que revertir es
-- volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0034-reversa.sql.
--
-- Idempotente: re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "nav_layout" (
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "nav_layout_organization_id_role_pk" PRIMARY KEY("organization_id","role"),
	CONSTRAINT "nav_layout_role_chk" CHECK ("nav_layout"."role" in ('owner', 'coordinador', 'asesor')),
	CONSTRAINT "nav_layout_items_chk" CHECK (jsonb_typeof("nav_layout"."items") = 'array')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nav_layout_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nav_layout_event_role_chk" CHECK ("nav_layout_event"."role" in ('owner', 'coordinador', 'asesor')),
	CONSTRAINT "nav_layout_event_action_chk" CHECK ("nav_layout_event"."action" in ('saved', 'reset'))
);
--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "knowledge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "lab" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "agent" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "team_chat" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "results" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "custom_nav" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nav_layout" ADD CONSTRAINT "nav_layout_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nav_layout" ADD CONSTRAINT "nav_layout_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nav_layout_event" ADD CONSTRAINT "nav_layout_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nav_layout_event" ADD CONSTRAINT "nav_layout_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_layout_event_org_at_idx" ON "nav_layout_event" USING btree ("organization_id","at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_lab_requires_agent_chk" CHECK (not "organization_module"."lab" or "organization_module"."agent");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Bitácora append-only: ninguna fila se reescribe. Única excepción: el
-- `ON DELETE SET NULL` de `actor_user_id` cuando se borra a la persona (todo
-- lo demás igual). DELETE no se bloquea: la purga de una organización la
-- borra en cascada.
CREATE OR REPLACE FUNCTION nav_layout_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_user_id IS NULL
    AND (NEW.id, NEW.organization_id, NEW.role, NEW.action, NEW.before, NEW.after, NEW.at)
      IS NOT DISTINCT FROM (OLD.id, OLD.organization_id, OLD.role, OLD.action, OLD.before, OLD.after, OLD.at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'nav_layout_event es append-only';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS nav_layout_event_no_update ON "nav_layout_event";--> statement-breakpoint
CREATE TRIGGER nav_layout_event_no_update BEFORE UPDATE ON "nav_layout_event"
  FOR EACH ROW EXECUTE FUNCTION nav_layout_event_append_only();--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nav_layout', 'nav_layout_event'] LOOP
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
