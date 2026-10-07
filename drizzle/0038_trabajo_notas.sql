-- 033, PR 2 — Módulo «Trabajo»: Notas (tipo Keep).
--
-- `work_note`: notas internas del equipo. Mismo módulo que Tareas
-- (`organization_module.trabajo`, de la 0037): no hay columna nueva.
-- Color de una lista cerrada (CHECK). FKs compuestas (misma organización)
-- hacia contacto y conversación con ON DELETE SET NULL de SOLO esa columna
-- (Postgres 15+, como la 0036/0037): borrar el contacto o el chat deja la
-- nota sin ligadura (vuelve a ser solo de quien la escribió), nunca toca
-- organization_id. Autor → user(id) con SET NULL.
--
-- Solo aditiva: el código anterior ignora la tabla nueva, así que revertir es
-- volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0038-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada. Tabla de dominio con RLS forzado (política de la 0027).
CREATE TABLE IF NOT EXISTS "work_note" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text,
	"body" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'ninguno' NOT NULL,
	"pinned_at" timestamp,
	"archived_at" timestamp,
	"author_user_id" text,
	"contact_id" text,
	"conversation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_note_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "work_note_color_chk" CHECK ("work_note"."color" in ('ninguno', 'amarillo', 'verde', 'azul', 'rosa', 'morado')),
	CONSTRAINT "work_note_title_chk" CHECK ("work_note"."title" is null or char_length("work_note"."title") <= 200),
	CONSTRAINT "work_note_body_chk" CHECK (char_length("work_note"."body") <= 10000),
	CONSTRAINT "work_note_not_empty_chk" CHECK (char_length("work_note"."body") > 0 or char_length(coalesce("work_note"."title", '')) > 0)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_note" ADD CONSTRAINT "work_note_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_note" ADD CONSTRAINT "work_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- ON DELETE SET NULL ("columna") lleva la lista de columnas (Postgres 15+),
-- igual que la 0024/0025/0036/0037: borrar el contacto no toca organization_id.
DO $$ BEGIN
	ALTER TABLE "work_note" ADD CONSTRAINT "work_note_org_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contact"("organization_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_note" ADD CONSTRAINT "work_note_org_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_note_org_author_idx" ON "work_note" USING btree ("organization_id","author_user_id","archived_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_note_org_contact_idx" ON "work_note" USING btree ("organization_id","contact_id");--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_note'] LOOP
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
