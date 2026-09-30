-- Reversa de drizzle/0024: vuelve a las FK simples (x_id) → padre(id) con su
-- acción original y quita las compuestas y los UNIQUE (organization_id, id).
-- Idempotente. Uso (Coolify → Postgres → Terminal):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0024-reversa.sql
-- (o pegando su contenido). La fila de drizzle.__drizzle_migrations NO se
-- toca: si después se vuelve a desplegar el código con 0024, hay que borrar
-- esa fila para que se re-aplique.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_contact_id_contact_id_fk') THEN
    ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_media_asset_id_media_asset_id_fk') THEN
    ALTER TABLE "message" ADD CONSTRAINT "message_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_org_media_asset_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_contact_id_contact_id_fk') THEN
    ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_stage_id_pipeline_stage_id_fk') THEN
    ALTER TABLE "lead" ADD CONSTRAINT "lead_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stage" ("id") ON DELETE NO ACTION;
  END IF;
END $$;
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_org_stage_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_contact_id_contact_id_fk') THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_lead_id_lead_id_fk') THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "lead" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_org_lead_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_template_id_template_id_fk') THEN
    ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "template" ("id") ON DELETE RESTRICT;
  END IF;
END $$;
ALTER TABLE "campaign" DROP CONSTRAINT IF EXISTS "campaign_org_template_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipient_campaign_id_campaign_id_fk') THEN
    ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaign" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_org_campaign_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipient_contact_id_contact_id_fk') THEN
    ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_tag_assignment_contact_id_contact_id_fk') THEN
    ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_tag_assignment" DROP CONSTRAINT IF EXISTS "contact_tag_assignment_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_tag_assignment_tag_id_contact_tag_id_fk') THEN
    ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_tag_id_contact_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "contact_tag" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_tag_assignment" DROP CONSTRAINT IF EXISTS "contact_tag_assignment_org_tag_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_participant_contact_id_contact_id_fk') THEN
    ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "contact_participant" DROP CONSTRAINT IF EXISTS "contact_participant_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_contact_id_contact_id_fk') THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_org_contact_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_conversation_id_conversation_id_fk') THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_org_conversation_fk";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_image_asset_id_media_asset_id_fk') THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_image_asset_id_media_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "media_asset" ("id") ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_org_image_asset_fk";
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_org_id_uq";
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_org_id_uq";
ALTER TABLE "media_asset" DROP CONSTRAINT IF EXISTS "media_asset_org_id_uq";
ALTER TABLE "pipeline_stage" DROP CONSTRAINT IF EXISTS "pipeline_stage_org_id_uq";
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_org_id_uq";
ALTER TABLE "template" DROP CONSTRAINT IF EXISTS "template_org_id_uq";
ALTER TABLE "campaign" DROP CONSTRAINT IF EXISTS "campaign_org_id_uq";
ALTER TABLE "contact_tag" DROP CONSTRAINT IF EXISTS "contact_tag_org_id_uq";
COMMIT;
