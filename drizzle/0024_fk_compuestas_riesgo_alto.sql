-- Fase 1 multitenant, PR 2 (H6): FK compuestas de RIESGO ALTO (datos de clientes).
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
-- Reversa: scripts/sql/0024-reversa.sql (recrea las FK simples).
-- Aborta SIN tocar nada si hay filas que cruzan organizaciones (ver abajo).

DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'Fase 1 (%): hace falta PostgreSQL 15 o superior (ON DELETE SET NULL con lista de columnas); este servidor es %. No se cambió nada.',
      '0024', current_setting('server_version');
  END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
  cruces text;
BEGIN
  SELECT string_agg(format('  %s: %s fila(s)', relacion, filas), E'\n')
    INTO cruces
  FROM (
  select 'conversation.contact_id → contact' as relacion, count(*) as filas from "conversation" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'message.conversation_id → conversation' as relacion, count(*) as filas from "message" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'message.media_asset_id → media_asset' as relacion, count(*) as filas from "message" h join "media_asset" pa on pa."id" = h."media_asset_id" where pa."organization_id" <> h."organization_id"
  union all select 'lead.contact_id → contact' as relacion, count(*) as filas from "lead" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'lead.stage_id → pipeline_stage' as relacion, count(*) as filas from "lead" h join "pipeline_stage" pa on pa."id" = h."stage_id" where pa."organization_id" <> h."organization_id"
  union all select 'booking.contact_id → contact' as relacion, count(*) as filas from "booking" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'booking.conversation_id → conversation' as relacion, count(*) as filas from "booking" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'booking.lead_id → lead' as relacion, count(*) as filas from "booking" h join "lead" pa on pa."id" = h."lead_id" where pa."organization_id" <> h."organization_id"
  union all select 'campaign.template_id → template' as relacion, count(*) as filas from "campaign" h join "template" pa on pa."id" = h."template_id" where pa."organization_id" <> h."organization_id"
  union all select 'campaign_recipient.campaign_id → campaign' as relacion, count(*) as filas from "campaign_recipient" h join "campaign" pa on pa."id" = h."campaign_id" where pa."organization_id" <> h."organization_id"
  union all select 'campaign_recipient.contact_id → contact' as relacion, count(*) as filas from "campaign_recipient" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_tag_assignment.contact_id → contact' as relacion, count(*) as filas from "contact_tag_assignment" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_tag_assignment.tag_id → contact_tag' as relacion, count(*) as filas from "contact_tag_assignment" h join "contact_tag" pa on pa."id" = h."tag_id" where pa."organization_id" <> h."organization_id"
  union all select 'contact_participant.contact_id → contact' as relacion, count(*) as filas from "contact_participant" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'ad_attribution.contact_id → contact' as relacion, count(*) as filas from "ad_attribution" h join "contact" pa on pa."id" = h."contact_id" where pa."organization_id" <> h."organization_id"
  union all select 'ad_attribution.conversation_id → conversation' as relacion, count(*) as filas from "ad_attribution" h join "conversation" pa on pa."id" = h."conversation_id" where pa."organization_id" <> h."organization_id"
  union all select 'ad_attribution.image_asset_id → media_asset' as relacion, count(*) as filas from "ad_attribution" h join "media_asset" pa on pa."id" = h."image_asset_id" where pa."organization_id" <> h."organization_id"
  ) t WHERE filas > 0;
  IF cruces IS NOT NULL THEN
    RAISE EXCEPTION E'Fase 1 (0024): hay filas que cuelgan de un padre de OTRA organización. No se cambió nada.\n%\nRevísalas con scripts/sql/cruces-entre-organizaciones.sql', cruces;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contact" ADD CONSTRAINT "contact_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead" ADD CONSTRAINT "lead_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "template" ADD CONSTRAINT "template_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "campaign" ADD CONSTRAINT "campaign_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_org_id_uq" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_org_contact_fk' AND conrelid = '"conversation"'::regclass) THEN
    ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "conversation" VALIDATE CONSTRAINT "conversation_org_contact_fk";--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_org_conversation_fk' AND conrelid = '"message"'::regclass) THEN
    ALTER TABLE "message" ADD CONSTRAINT "message_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "message" VALIDATE CONSTRAINT "message_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_org_media_asset_fk' AND conrelid = '"message"'::regclass) THEN
    ALTER TABLE "message" ADD CONSTRAINT "message_org_media_asset_fk" FOREIGN KEY ("organization_id", "media_asset_id") REFERENCES "media_asset" ("organization_id", "id") ON DELETE SET NULL ("media_asset_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "message" VALIDATE CONSTRAINT "message_org_media_asset_fk";--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_media_asset_id_media_asset_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_org_contact_fk' AND conrelid = '"lead"'::regclass) THEN
    ALTER TABLE "lead" ADD CONSTRAINT "lead_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead" VALIDATE CONSTRAINT "lead_org_contact_fk";--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_org_stage_fk' AND conrelid = '"lead"'::regclass) THEN
    ALTER TABLE "lead" ADD CONSTRAINT "lead_org_stage_fk" FOREIGN KEY ("organization_id", "stage_id") REFERENCES "pipeline_stage" ("organization_id", "id") ON DELETE NO ACTION NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lead" VALIDATE CONSTRAINT "lead_org_stage_fk";--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_org_contact_fk' AND conrelid = '"booking"'::regclass) THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "booking" VALIDATE CONSTRAINT "booking_org_contact_fk";--> statement-breakpoint
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_org_conversation_fk' AND conrelid = '"booking"'::regclass) THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE SET NULL ("conversation_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "booking" VALIDATE CONSTRAINT "booking_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_org_lead_fk' AND conrelid = '"booking"'::regclass) THEN
    ALTER TABLE "booking" ADD CONSTRAINT "booking_org_lead_fk" FOREIGN KEY ("organization_id", "lead_id") REFERENCES "lead" ("organization_id", "id") ON DELETE SET NULL ("lead_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "booking" VALIDATE CONSTRAINT "booking_org_lead_fk";--> statement-breakpoint
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_lead_id_lead_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_org_template_fk' AND conrelid = '"campaign"'::regclass) THEN
    ALTER TABLE "campaign" ADD CONSTRAINT "campaign_org_template_fk" FOREIGN KEY ("organization_id", "template_id") REFERENCES "template" ("organization_id", "id") ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "campaign" VALIDATE CONSTRAINT "campaign_org_template_fk";--> statement-breakpoint
ALTER TABLE "campaign" DROP CONSTRAINT IF EXISTS "campaign_template_id_template_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipient_org_campaign_fk' AND conrelid = '"campaign_recipient"'::regclass) THEN
    ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_org_campaign_fk" FOREIGN KEY ("organization_id", "campaign_id") REFERENCES "campaign" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "campaign_recipient" VALIDATE CONSTRAINT "campaign_recipient_org_campaign_fk";--> statement-breakpoint
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_campaign_id_campaign_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipient_org_contact_fk' AND conrelid = '"campaign_recipient"'::regclass) THEN
    ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE SET NULL ("contact_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "campaign_recipient" VALIDATE CONSTRAINT "campaign_recipient_org_contact_fk";--> statement-breakpoint
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_tag_assignment_org_contact_fk' AND conrelid = '"contact_tag_assignment"'::regclass) THEN
    ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_tag_assignment" VALIDATE CONSTRAINT "contact_tag_assignment_org_contact_fk";--> statement-breakpoint
ALTER TABLE "contact_tag_assignment" DROP CONSTRAINT IF EXISTS "contact_tag_assignment_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_tag_assignment_org_tag_fk' AND conrelid = '"contact_tag_assignment"'::regclass) THEN
    ALTER TABLE "contact_tag_assignment" ADD CONSTRAINT "contact_tag_assignment_org_tag_fk" FOREIGN KEY ("organization_id", "tag_id") REFERENCES "contact_tag" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_tag_assignment" VALIDATE CONSTRAINT "contact_tag_assignment_org_tag_fk";--> statement-breakpoint
ALTER TABLE "contact_tag_assignment" DROP CONSTRAINT IF EXISTS "contact_tag_assignment_tag_id_contact_tag_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_participant_org_contact_fk' AND conrelid = '"contact_participant"'::regclass) THEN
    ALTER TABLE "contact_participant" ADD CONSTRAINT "contact_participant_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "contact_participant" VALIDATE CONSTRAINT "contact_participant_org_contact_fk";--> statement-breakpoint
ALTER TABLE "contact_participant" DROP CONSTRAINT IF EXISTS "contact_participant_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_org_contact_fk' AND conrelid = '"ad_attribution"'::regclass) THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contact" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ad_attribution" VALIDATE CONSTRAINT "ad_attribution_org_contact_fk";--> statement-breakpoint
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_contact_id_contact_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_org_conversation_fk' AND conrelid = '"ad_attribution"'::regclass) THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_org_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ad_attribution" VALIDATE CONSTRAINT "ad_attribution_org_conversation_fk";--> statement-breakpoint
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_conversation_id_conversation_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_attribution_org_image_asset_fk' AND conrelid = '"ad_attribution"'::regclass) THEN
    ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_org_image_asset_fk" FOREIGN KEY ("organization_id", "image_asset_id") REFERENCES "media_asset" ("organization_id", "id") ON DELETE SET NULL ("image_asset_id") NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ad_attribution" VALIDATE CONSTRAINT "ad_attribution_org_image_asset_fk";--> statement-breakpoint
ALTER TABLE "ad_attribution" DROP CONSTRAINT IF EXISTS "ad_attribution_image_asset_id_media_asset_id_fk";
