-- 031, PR B — Agentes por etapa del pipeline.
--
-- 1. `agent_stage_assignment`: qué agente atiende cada etapa. La llave
--    primaria (organization_id, stage_id) es «un agente por etapa» (D6); un
--    agente puede tener varias. FKs compuestas (misma organización) con
--    cascade: borrar la etapa o el agente borra la asignación. Archivar un
--    agente NO la borra: el turno la ignora y atiende el general (la pantalla
--    lo avisa).
-- 2. `conversation.last_agent_id`: el agente del último turno real, para
--    anotar `agent_changed` en la línea de tiempo solo cuando cambia.
--    `contact_activity_event.kind` es texto sin CHECK: el tipo nuevo no
--    necesita SQL.
--
-- Solo aditiva: el código anterior ignora la tabla y la columna nuevas, así
-- que revertir es volver a desplegar la imagen anterior (atiende siempre el
-- general). Limpieza opcional: scripts/sql/0036-reversa.sql. Idempotente:
-- re-ejecutable sobre una base ya migrada. Tabla de dominio con RLS forzado
-- (política de la 0027).
CREATE TABLE IF NOT EXISTS "agent_stage_assignment" (
	"organization_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_stage_assignment_pk" PRIMARY KEY("organization_id","stage_id")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "last_agent_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_stage_assignment" ADD CONSTRAINT "agent_stage_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_stage_assignment" ADD CONSTRAINT "agent_stage_assignment_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_stage_assignment" ADD CONSTRAINT "agent_stage_assignment_org_stage_fk" FOREIGN KEY ("organization_id","stage_id") REFERENCES "public"."pipeline_stage"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_stage_assignment" ADD CONSTRAINT "agent_stage_assignment_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agent"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_stage_assignment_agent_idx" ON "agent_stage_assignment" USING btree ("organization_id","agent_id");--> statement-breakpoint
-- ON DELETE SET NULL ("last_agent_id") lleva la lista de columnas (Postgres
-- 15+), igual que la 0024/0025: borrar un agente no toca organization_id.
-- NOT VALID + VALIDATE (como la 0025): el candado fuerte dura un instante y
-- la validación (todas las filas en NULL) no bloquea escrituras.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_org_last_agent_fk' AND conrelid = '"conversation"'::regclass) THEN
    ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_last_agent_fk" FOREIGN KEY ("organization_id", "last_agent_id") REFERENCES "agent" ("organization_id", "id") ON DELETE SET NULL ("last_agent_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "conversation" VALIDATE CONSTRAINT "conversation_org_last_agent_fk";--> statement-breakpoint
-- RLS de la tabla de dominio nueva (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_stage_assignment'] LOOP
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
