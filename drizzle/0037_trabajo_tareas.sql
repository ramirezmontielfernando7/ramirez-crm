-- 033, PR 1 — Módulo «Trabajo»: Tareas.
--
-- 1. `organization_module.trabajo`: el módulo nuevo (Tareas, y en el PR 2
--    Notas). DEFAULT false: a las organizaciones que ya existen no les
--    aparece nada nuevo; lo encienden /platform o los perfiles de alta.
--    Citas sigue siendo la columna `agenda` (sin cambios).
-- 2. `work_task`: tareas del equipo. FKs compuestas (misma organización)
--    hacia contacto y conversación con ON DELETE SET NULL de SOLO esa
--    columna (Postgres 15+, como la 0036): borrar el contacto o el chat deja
--    la tarea sin ligadura, nunca toca organization_id. Responsable, autor y
--    quién la marcó hecha → user(id) con SET NULL.
--
-- Solo aditiva: el código anterior ignora la tabla y la columna nuevas, así
-- que revertir es volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0037-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada. Tabla de dominio con RLS forzado (política de la 0027).
CREATE TABLE IF NOT EXISTS "work_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp,
	"assignee_user_id" text,
	"created_by" text,
	"contact_id" text,
	"conversation_id" text,
	"done_at" timestamp,
	"done_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_task_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "work_task_title_chk" CHECK (char_length("work_task"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "trabajo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- ON DELETE SET NULL ("columna") lleva la lista de columnas (Postgres 15+),
-- igual que la 0024/0025/0036: borrar el contacto no toca organization_id.
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_org_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contact"("organization_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_task" ADD CONSTRAINT "work_task_org_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_task_org_assignee_idx" ON "work_task" USING btree ("organization_id","assignee_user_id","done_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_task_org_contact_idx" ON "work_task" USING btree ("organization_id","contact_id");--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_task'] LOOP
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
