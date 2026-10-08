-- 036 (PR 1) — Consumo de IA por agente: `ai_usage_agent`.
--
-- El mismo turno que ya cuenta `ai_usage` (por organización, mes UTC y
-- tipo), desglosado por el agente que lo pidió. Solo reporta: los topes
-- siguen comparándose contra la fila `total` de `ai_usage`. Tipos con agente:
-- `agent` (turno real), `lab` (Laboratorio y vista previa) y `judge` (el juez
-- evaluando a ese agente). La escritura y los embeddings no tienen agente.
-- Sin relleno retroactivo: el desglose existe desde esta migración.
--
-- FK compuesta (misma organización) hacia `agent`, con CASCADE. Tabla de
-- dominio con RLS forzado (política de la 0027).
--
-- Solo aditiva: el código anterior ignora la tabla, así que revertir es
-- volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0042-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada.
CREATE TABLE IF NOT EXISTS "ai_usage_agent" (
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_agent_organization_id_period_agent_id_kind_pk" PRIMARY KEY("organization_id","period","agent_id","kind"),
	CONSTRAINT "ai_usage_agent_kind_chk" CHECK ("ai_usage_agent"."kind" in ('agent', 'lab', 'judge'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_usage_agent" ADD CONSTRAINT "ai_usage_agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- FK compuesta: el consumo de un agente de A jamás se anota en B.
DO $$ BEGIN
	ALTER TABLE "ai_usage_agent" ADD CONSTRAINT "ai_usage_agent_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
ALTER TABLE "ai_usage_agent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage_agent" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_usage_agent";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_usage_agent"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));
