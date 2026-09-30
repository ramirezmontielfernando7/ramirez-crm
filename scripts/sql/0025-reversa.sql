-- Reversa de drizzle/0025: vuelve a las FK simples (x_id) → padre(id) con su
-- acción original y quita las compuestas y los UNIQUE (organization_id, id).
-- Idempotente. Uso (Coolify → Postgres → Terminal):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0025-reversa.sql
-- (o pegando su contenido). La fila de drizzle.__drizzle_migrations NO se
-- toca: si después se vuelve a desplegar el código con 0025, hay que borrar
-- esa fila para que se re-aplique.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_contact_id_contact_id_fk') THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_lead_id_lead_id_fk') THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "lead" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_org_lead_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_from_stage_id_pipeline_stage_id_fk') THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_from_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "pipeline_stage" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_org_from_stage_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_event_to_stage_id_pipeline_stage_id_fk') THEN
    ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_to_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "pipeline_stage" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "lead_stage_event" DROP CONSTRAINT IF EXISTS "lead_stage_event_org_to_stage_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_assignment_event_contact_id_contact_id_fk') THEN
    ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_assignment_event" DROP CONSTRAINT IF EXISTS "contact_assignment_event_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_assignment_event_lead_id_lead_id_fk') THEN
    ALTER TABLE "contact_assignment_event" ADD CONSTRAINT "contact_assignment_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "lead" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "contact_assignment_event" DROP CONSTRAINT IF EXISTS "contact_assignment_event_org_lead_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_activity_event_contact_id_contact_id_fk') THEN
    ALTER TABLE "contact_activity_event" ADD CONSTRAINT "contact_activity_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_activity_event" DROP CONSTRAINT IF EXISTS "contact_activity_event_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_participant_event_contact_id_contact_id_fk') THEN
    ALTER TABLE "contact_participant_event" ADD CONSTRAINT "contact_participant_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_participant_event" DROP CONSTRAINT IF EXISTS "contact_participant_event_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_event_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "conversion_event" DROP CONSTRAINT IF EXISTS "conversion_event_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_event_attribution_id_ad_attribution_id_fk') THEN
    ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_attribution_id_ad_attribution_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "ad_attribution" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "conversion_event" DROP CONSTRAINT IF EXISTS "conversion_event_org_attribution_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offered_slot_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "offered_slot" DROP CONSTRAINT IF EXISTS "offered_slot_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_case_run_id_agent_test_run_id_fk') THEN
    ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_run_id_agent_test_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent_test_run" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "agent_test_case" DROP CONSTRAINT IF EXISTS "agent_test_case_org_run_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_case_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "agent_test_case" DROP CONSTRAINT IF EXISTS "agent_test_case_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capi_settings_qualified_stage_id_pipeline_stage_id_fk') THEN
    ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_qualified_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("qualified_stage_id") REFERENCES "pipeline_stage" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "capi_settings" DROP CONSTRAINT IF EXISTS "capi_settings_org_qualified_stage_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_member_thread_id_team_chat_thread_id_fk') THEN
    ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "team_chat_thread" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "team_chat_member" DROP CONSTRAINT IF EXISTS "team_chat_member_org_thread_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_read_state_thread_id_team_chat_thread_id_fk') THEN
    ALTER TABLE "team_chat_read_state" ADD CONSTRAINT "team_chat_read_state_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "team_chat_thread" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "team_chat_read_state" DROP CONSTRAINT IF EXISTS "team_chat_read_state_org_thread_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_attachment_thread_id_team_chat_thread_id_fk') THEN
    ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "team_chat_thread" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "team_chat_attachment" DROP CONSTRAINT IF EXISTS "team_chat_attachment_org_thread_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_message_thread_id_team_chat_thread_id_fk') THEN
    ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "team_chat_thread" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "team_chat_message" DROP CONSTRAINT IF EXISTS "team_chat_message_org_thread_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_message_attachment_id_team_chat_attachment_id_fk') THEN
    ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_attachment_id_team_chat_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "team_chat_attachment" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "team_chat_message" DROP CONSTRAINT IF EXISTS "team_chat_message_org_attachment_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_chat_reaction_message_id_team_chat_message_id_fk') THEN
    ALTER TABLE "team_chat_reaction" ADD CONSTRAINT "team_chat_reaction_message_id_team_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "team_chat_message" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "team_chat_reaction" DROP CONSTRAINT IF EXISTS "team_chat_reaction_org_message_fk";
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_org_id_uq";
ALTER TABLE "agent_test_run" DROP CONSTRAINT IF EXISTS "agent_test_run_org_id_uq";
ALTER TABLE "team_chat_thread" DROP CONSTRAINT IF EXISTS "team_chat_thread_org_id_uq";
ALTER TABLE "team_chat_attachment" DROP CONSTRAINT IF EXISTS "team_chat_attachment_org_id_uq";
ALTER TABLE "team_chat_message" DROP CONSTRAINT IF EXISTS "team_chat_message_org_id_uq";
COMMIT;
