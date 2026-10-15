-- 040 — Biblioteca unificada y plan comercial guardado.
--
-- `organization_plan.plan_key`: el CHECK pasa de ('custom') a
-- ('esencial', 'pro', 'ultra', 'custom'). Es el reflejo de los 13
-- interruptores (`planKeyOfModules`, src/lib/platform-modules.ts): lo
-- sincroniza la app en el alta y en cada cambio de módulos o topes desde
-- /platform (`syncPlanKey`). Relleno de abajo: cada organización con módulos
-- guardados recibe el plan que corresponde HOY a sus interruptores (copia de
-- las plantillas de `MODULE_PROFILES` al 040; lo que no coincide, 'custom').
--
-- `knowledge_entry.show_in_chat`: ¿aparece en la Bandeja para envío rápido?
-- Las filas de antes, sí (DEFAULT true). `false` = el archivo solo se guarda
-- como original del documento del agente.
-- `kb_document.knowledge_entry_id`: la entrada de Conocimientos que guarda el
-- ARCHIVO de ese documento (un archivo, dos destinos). FK compuesta (misma
-- organización); borrar la entrada deja el documento «solo IA» (SET NULL
-- SOLO de esa columna, Postgres 15+, como la 0043). Una entrada, a lo más un
-- documento (índice único parcial).
--
-- Solo aditiva (el código anterior ignora las columnas y un plan distinto de
-- 'custom' solo cambia la etiqueta). Idempotente: re-ejecutable.
ALTER TABLE "organization_plan" DROP CONSTRAINT IF EXISTS "organization_plan_key_chk";--> statement-breakpoint
ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_key_chk" CHECK ("organization_plan"."plan_key" in ('esencial', 'pro', 'ultra', 'custom'));--> statement-breakpoint
ALTER TABLE "kb_document" ADD COLUMN IF NOT EXISTS "knowledge_entry_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD COLUMN IF NOT EXISTS "show_in_chat" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_org_id_uq" UNIQUE("organization_id","id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_org_knowledge_fk" FOREIGN KEY ("organization_id","knowledge_entry_id") REFERENCES "public"."knowledge_entry"("organization_id","id") ON DELETE SET NULL ("knowledge_entry_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kb_document_org_knowledge_uq" ON "kb_document" USING btree ("organization_id","knowledge_entry_id") WHERE "kb_document"."knowledge_entry_id" is not null;--> statement-breakpoint
-- Relleno del plan guardado (re-ejecutable: siempre recalcula).
INSERT INTO "organization_plan" ("organization_id", "plan_key")
SELECT m."organization_id",
  CASE
    WHEN m."team_chat" AND m."knowledge" AND m."results" AND m."trabajo"
      AND m."agent" AND m."lab" AND m."agenda" AND m."atribucion" AND m."custom_nav"
      AND 'instagram' = ANY(m."channels") AND 'messenger' = ANY(m."channels")
      AND m."campaigns" AND m."asistente" THEN 'ultra'
    WHEN m."team_chat" AND m."knowledge" AND m."results" AND m."trabajo"
      AND m."agent" AND m."lab" AND m."agenda" AND m."atribucion" AND m."custom_nav"
      AND 'instagram' = ANY(m."channels") AND 'messenger' = ANY(m."channels")
      AND NOT m."campaigns" AND NOT m."asistente" THEN 'pro'
    WHEN m."team_chat" AND m."knowledge" AND m."results" AND m."trabajo"
      AND NOT m."agent" AND NOT m."lab" AND NOT m."agenda" AND NOT m."atribucion" AND NOT m."custom_nav"
      AND NOT ('instagram' = ANY(m."channels")) AND NOT ('messenger' = ANY(m."channels"))
      AND NOT m."campaigns" AND NOT m."asistente" THEN 'esencial'
    ELSE 'custom'
  END
FROM "organization_module" m
ON CONFLICT ("organization_id") DO UPDATE SET "plan_key" = EXCLUDED."plan_key";
