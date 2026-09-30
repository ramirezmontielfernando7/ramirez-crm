-- Fase 1 multitenant, PR 2 (H6): FK compuestas de RIESGO MEDIO (bitácoras, Laboratorio, agenda, chat de equipo).
--
-- Cada FK hijo→padre de la lista pasa de (x_id) → padre(id) a
-- (organization_id, x_id) → padre(organization_id, id), con la MISMA acción
-- al borrar. Así la base de datos hace imposible que una fila de la
-- organización A cuelgue de un padre de la organización B, aunque el código
-- se equivoque.
--
-- Por qué REEMPLAZAR y no agregar al lado: con las dos FK, que un borrado
-- funcione depende del orden en que Postgres dispara sus triggers internos
-- (el de creación), y un pg_dump/restauración lo puede invertir. Verificado.
--
-- ON DELETE SET NULL ("x_id") lleva la lista de columnas (Postgres 15+):
-- sin ella se pondría en NULL también organization_id (NOT NULL) y el
-- borrado del padre fallaría. drizzle-kit no sabe escribirla: este SQL es a
-- mano y schema.ts lo documenta en cada foreignKey.
--
-- Idempotente: se puede correr dos veces y sobre una base ya migrada.
-- Reversa: scripts/sql/0025-reversa.sql (recrea las FK simples).
-- Aborta SIN tocar nada si hay filas que cruzan organizaciones (ver abajo).

DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'Fase 1 (%): hace falta PostgreSQL 15 o superior (ON DELETE SET NULL con lista de columnas); este servidor es %. No se cambió nada.',
      '0025', current_setting('server_version');
  END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
  cruces text;
BEGIN
  SELECT string_agg(format('  %s: %s fila(s)', relacion, filas), E'\n')
    INTO cruces
  FROM (
  select 'lead_stage_event.contact_id → contact' as relacion, count(*) as filas from "lead_stage_event" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'lead_stage_event.lead_id → lead' as relacion, count(*) as filas from "lead_stage_event" h join "lead" pa on pa."id" = h."lead_id" where pa."organization_id" <> h."organization_id"
  union all select 'lead_stage_event.from_stage_id → pipeline_stage' as relacion, count(*) as filas from "lead_stage_event" h join "pipeline_stage" pa on pa."id" = h."from_stage_id" where pa."organization_id" <> h."organization_id"
  union all select 'lead_stage_event.to_stage_id → pipeline_stage' as relacion, count(*) as filas from "lead_stage_event" h join "pipeline_stage" pa on pa."id" = h."to_stage_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_assignment_event.contact_id → contact' as relacion, count(*) as filas from "contact_assignment_event" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_assignment_event.lead_id → lead' as relacion, count(*) as filas from "contact_assignment_event" h join "lead" pa on pa."id" = h."lead_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_activity_event.contact_id → contact' as relacion, count(*) as filas from "contact_activity_event" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_participant_event.contact_id → contact' as relacion, count(*) as filas from "contact_participant_event" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'conversion_event.conversation_id → conversation' as relacion, count(*) as filas from "conversion_event" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'conversion_event.attribution_id → ad_attribution' as relacion, count(*) as filas from "conversion_event" h join "ad_attribution" pa on pa."id" = h."attribution_id" where pa."organization_id" <> h."organization_id"
  union all select 'offered_slot.conversation_id → conversation' as relacion, count(*) as filas from "offered_slot" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'agent_test_case.run_id → agent_test_run' as relacion, count(*) as filas from "agent_test_case" h join "agent_test_run" pa on pa."id" = h."run_id" where pa."organization_id" <> h."organization_id"
  union all select 'agent_test_case.conversation_id → conversation' as relacion, count(*) as filas from "agent_test_case" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'capi_settings.qualified_stage_id → pipeline_stage' as relacion, count(*) as filas from "capi_settings" h join "pipeline_stage" pa on pa."id" = h."qualified_stage_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_member.thread_id → team_chat_thread' as relacion, count(*) as filas from "team_chat_member" h join "team_chat_thread" pa on pa."id" = h."thread_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_read_state.thread_id → team_chat_thread' as relacion, count(*) as filas from "team_chat_read_state" h join "team_chat_thread" pa on pa."id" = h."thread_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_attachment.thread_id → team_chat_thread' as relacion, count(*) as filas from "team_chat_attachment" h join "team_chat_thread" pa on pa."id" = h."thread_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_message.thread_id → team_chat_thread' as relacion, count(*) as filas from "team_chat_message" h join "team_chat_thread" pa on pa."id" = h."thread_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_message.attachment_id → team_chat_attachment' as relacion, count(*) as filas from "team_chat_message" h join "team_chat_attachment" pa on pa."id" = h."attachment_id" where pa."organization_id" <> h."organization_id"
  union all select 'team_chat_reaction.message_id → team_chat_message' as relacion, count(*) as filas from "team_chat_reaction" h join "team_chat_message" pa on pa."id" = h."message_id" where pa."organization_id" <> h."organization_id"
  ) t WHERE filas > 0;
  IF cruces IS NOT NULL THEN
    RAISE EXCEPTION E'Fase 1 (0025): hay filas que cuelgan de un padre de OTRA organización. No se cambió nada.\n%\nRevísalas con scripts/sql/cruces-entre-organizaciones.sql', cruces;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_test_run" ADD CONSTRAINT "agent_test_run_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "team_chat_thread" ADD CONSTRAINT "team_chat_thread_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_org_contact_fk' AND conrelid = '"lead_stage_event"'::regclass) THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead_stage_event" VALIDATE CONSTRAINT "lead_stage_event_org_contact_fk";--> statement-breakpoint
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_org_lead_fk' AND conrelid = '"lead_stage_event"'::regclass) THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_org_lead_fk" FOREIGN KEY ("organization_id", "lead_id") REFERENCES "lead" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead_stage_event" VALIDATE CONSTRAINT "lead_stage_event_org_lead_fk";--> statement-breakpoint
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_lead_id_lead_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_org_from_stage_fk' AND conrelid = '"lead_stage_event"'::regclass) THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_org_from_stage_fk" FOREIGN KEY ("organization_id", "from_stage_id") REFERENCES "pipeline_stage" ("organization_id", "id") ON DELETE SET NULL ("from_stage_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead_stage_event" VALIDATE CONSTRAINT "lead_stage_event_org_from_stage_fk";--> statement-breakpoint
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_from_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_org_to_stage_fk' AND conrelid = '"lead_stage_event"'::regclass) THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_org_to_stage_fk" FOREIGN KEY ("organization_id", "to_stage_id") REFERENCES "pipeline_stage" ("organization_id", "id") ON DELETE SET NULL ("to_stage_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead_stage_event" VALIDATE CONSTRAINT "lead_stage_event_org_to_stage_fk";--> statement-breakpoint
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_to_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_assignment_event_org_contact_fk' AND conrelid = '"contact_assignment_event"'::regclass) THEN
    ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_assignment_event" VALIDATE CONSTRAINT "contact_assignment_event_org_contact_fk";--> statement-breakpoint
ALTER TABLE "contact_assignment_event" DROP CONSTRAINT IF EXISTS "contact_assignment_event_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_assignment_event_org_lead_fk' AND conrelid = '"contact_assignment_event"'::regclass) THEN
    ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_org_lead_fk" FOREIGN KEY ("organization_id", "lead_id") REFERENCES "lead" ("organization_id", "id") ON DELETE SET NULL ("lead_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_assignment_event" VALIDATE CONSTRAINT "contact_assignment_event_org_lead_fk";--> statement-breakpoint
ALTER TABLE "contact_assignment_event" DROP CONSTRAINT IF EXISTS "contact_assignment_event_lead_id_lead_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_activity_event_org_contact_fk' AND conrelid = '"contact_activity_event"'::regclass) THEN
    ALTER TABLE "contact_activity_event" ADD CONSTRAINT "contact_activity_event_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_activity_event" VALIDATE CONSTRAINT "contact_activity_event_org_contact_fk";--> statement-breakpoint
ALTER TABLE "contact_activity_event" DROP CONSTRAINT IF EXISTS "contact_activity_event_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_participant_event_org_contact_fk' AND conrelid = '"contact_participant_event"'::regclass) THEN
    ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_participant_event" VALIDATE CONSTRAINT "contact_participant_event_org_contact_fk";--> statement-breakpoint
ALTER TABLE "contact_participant_event" DROP CONSTRAINT IF EXISTS "contact_participant_event_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_event_org_conversation_fk' AND conrelid = '"conversion_event"'::regclass) THEN
    ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "conversion_event" VALIDATE CONSTRAINT "conversion_event_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "conversion_event" DROP CONSTRAINT IF EXISTS "conversion_event_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_event_org_attribution_fk' AND conrelid = '"conversion_event"'::regclass) THEN
    ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_org_attribution_fk" FOREIGN KEY ("organization_id", "attribution_id") REFERENCES "ad_attribution" ("organization_id", "id") ON DELETE SET NULL ("attribution_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "conversion_event" VALIDATE CONSTRAINT "conversion_event_org_attribution_fk";--> statement-breakpoint
ALTER TABLE "conversion_event" DROP CONSTRAINT IF EXISTS "conversion_event_attribution_id_ad_attribution_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offered_slot_org_conversation_fk' AND conrelid = '"offered_slot"'::regclass) THEN
    ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "offered_slot" VALIDATE CONSTRAINT "offered_slot_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "offered_slot" DROP CONSTRAINT IF EXISTS "offered_slot_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_case_org_run_fk' AND conrelid = '"agent_test_case"'::regclass) THEN
    ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_org_run_fk" FOREIGN KEY ("organization_id", "run_id") REFERENCES "agent_test_run" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "agent_test_case" VALIDATE CONSTRAINT "agent_test_case_org_run_fk";--> statement-breakpoint
ALTER TABLE "agent_test_case" DROP CONSTRAINT IF EXISTS "agent_test_case_run_id_agent_test_run_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_case_org_conversation_fk' AND conrelid = '"agent_test_case"'::regclass) THEN
    ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE SET NULL ("conversation_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "agent_test_case" VALIDATE CONSTRAINT "agent_test_case_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "agent_test_case" DROP CONSTRAINT IF EXISTS "agent_test_case_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capi_settings_org_qualified_stage_fk' AND conrelid = '"capi_settings"'::regclass) THEN
    ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_org_qualified_stage_fk" FOREIGN KEY ("organization_id", "qualified_stage_id") REFERENCES "pipeline_stage" ("organization_id", "id") ON DELETE SET NULL ("qualified_stage_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "capi_settings" VALIDATE CONSTRAINT "capi_settings_org_qualified_stage_fk";--> statement-breakpoint
ALTER TABLE "capi_settings" DROP CONSTRAINT IF EXISTS "capi_settings_qualified_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_member_org_thread_fk' AND conrelid = '"team_chat_member"'::regclass) THEN
    ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_org_thread_fk" FOREIGN KEY ("organization_id", "thread_id") REFERENCES "team_chat_thread" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_member" VALIDATE CONSTRAINT "team_chat_member_org_thread_fk";--> statement-breakpoint
ALTER TABLE "team_chat_member" DROP CONSTRAINT IF EXISTS "team_chat_member_thread_id_team_chat_thread_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_read_state_org_thread_fk' AND conrelid = '"team_chat_read_state"'::regclass) THEN
    ALTER TABLE "team_chat_read_state" ADD CONSTRAINT "team_chat_read_state_org_thread_fk" FOREIGN KEY ("organization_id", "thread_id") REFERENCES "team_chat_thread" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_read_state" VALIDATE CONSTRAINT "team_chat_read_state_org_thread_fk";--> statement-breakpoint
ALTER TABLE "team_chat_read_state" DROP CONSTRAINT IF EXISTS "team_chat_read_state_thread_id_team_chat_thread_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_attachment_org_thread_fk' AND conrelid = '"team_chat_attachment"'::regclass) THEN
    ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_org_thread_fk" FOREIGN KEY ("organization_id", "thread_id") REFERENCES "team_chat_thread" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_attachment" VALIDATE CONSTRAINT "team_chat_attachment_org_thread_fk";--> statement-breakpoint
ALTER TABLE "team_chat_attachment" DROP CONSTRAINT IF EXISTS "team_chat_attachment_thread_id_team_chat_thread_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_message_org_thread_fk' AND conrelid = '"team_chat_message"'::regclass) THEN
    ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_org_thread_fk" FOREIGN KEY ("organization_id", "thread_id") REFERENCES "team_chat_thread" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_message" VALIDATE CONSTRAINT "team_chat_message_org_thread_fk";--> statement-breakpoint
ALTER TABLE "team_chat_message" DROP CONSTRAINT IF EXISTS "team_chat_message_thread_id_team_chat_thread_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_message_org_attachment_fk' AND conrelid = '"team_chat_message"'::regclass) THEN
    ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_org_attachment_fk" FOREIGN KEY ("organization_id", "attachment_id") REFERENCES "team_chat_attachment" ("organization_id", "id") ON DELETE SET NULL ("attachment_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_message" VALIDATE CONSTRAINT "team_chat_message_org_attachment_fk";--> statement-breakpoint
ALTER TABLE "team_chat_message" DROP CONSTRAINT IF EXISTS "team_chat_message_attachment_id_team_chat_attachment_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_reaction_org_message_fk' AND conrelid = '"team_chat_reaction"'::regclass) THEN
    ALTER TABLE "team_chat_reaction" ADD CONSTRAINT "team_chat_reaction_org_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "team_chat_message" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "team_chat_reaction" VALIDATE CONSTRAINT "team_chat_reaction_org_message_fk";--> statement-breakpoint
ALTER TABLE "team_chat_reaction" DROP CONSTRAINT IF EXISTS "team_chat_reaction_message_id_team_chat_message_id_fk";
