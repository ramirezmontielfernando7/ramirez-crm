-- 037 — Grupos de documentos y documentos exclusivos de un agente.
--
-- `kb_document_group`: los grupos de Laboratorio → Documentos (Ventas,
-- Dirección…). «General» NO es una fila: es `kb_document.group_id IS NULL`,
-- así los documentos de antes de esta migración ya están en General sin
-- tocar una sola fila (no hay relleno).
-- `kb_document.group_id`: el grupo del documento (NULL = General).
-- `kb_document.agent_id`: NULL = documento de la empresa; si no, exclusivo
-- de ese agente (y entonces sin grupo: CHECK `kb_document_owner_chk`).
--
-- FK compuestas (misma organización): un documento de A jamás cuelga de un
-- grupo ni de un agente de B. Borrar un grupo en la BD deja sus documentos en
-- General (SET NULL SOLO de `group_id`, Postgres 15+; un SET NULL a secas
-- intentaría anular también `organization_id`). El agente solo se borra de
-- verdad con su organización (CASCADE); archivarlo lo resuelve la app (037 D3).
-- Tabla de dominio con RLS forzado (política de la 0027).
--
-- Solo aditiva: el código anterior ignora la tabla y las columnas (ojo: con
-- la imagen anterior, un documento exclusivo lo leerían todos los agentes;
-- ver scripts/sql/0043-reversa.sql). Idempotente: re-ejecutable sobre una
-- base ya migrada.
CREATE TABLE IF NOT EXISTS "kb_document_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kb_document_group_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "kb_document_group_name_chk" CHECK (char_length("kb_document_group"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "kb_document" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "kb_document" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_document_group" ADD CONSTRAINT "kb_document_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Nombre único por organización sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS "kb_document_group_org_name_uq" ON "kb_document_group" USING btree ("organization_id",lower("name"));--> statement-breakpoint
-- FK compuesta: sin el grupo, el documento queda en General.
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_org_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."kb_document_group"("organization_id","id") ON DELETE SET NULL ("group_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- FK compuesta: el exclusivo de un agente de A jamás cuelga de un agente de B.
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_document_org_group_idx" ON "kb_document" USING btree ("organization_id","group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_document_org_agent_idx" ON "kb_document" USING btree ("organization_id","agent_id");--> statement-breakpoint
-- Un exclusivo no pertenece a ningún grupo (las filas de antes: NULL/NULL).
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_owner_chk" CHECK ("kb_document"."group_id" is null or "kb_document"."agent_id" is null);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
ALTER TABLE "kb_document_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_document_group" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "kb_document_group";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "kb_document_group"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));
