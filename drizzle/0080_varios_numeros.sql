-- 0080 — Varios números oficiales de WhatsApp por organización, en una sola
-- bandeja. ADITIVO e idempotente. Reversa: scripts/sql/0080-reversa.sql
--
-- 1. meta_credentials: se quita el candado «un número por organización» y se
--    agrega `label` (el nombre que la empresa le da al número).
-- 2. conversation.wa_phone_number_id: por qué número habla cada chat
--    (NULL = el principal, el más antiguo de la organización).
DROP INDEX IF EXISTS "meta_credentials_org_uq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_credentials_org_idx" ON "meta_credentials" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "wa_phone_number_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_wa_number_idx" ON "conversation" USING btree ("organization_id","wa_phone_number_id") WHERE "wa_phone_number_id" is not null;
--> statement-breakpoint
-- Los chats de WhatsApp que ya existían hablan por el número que la
-- organización tiene hoy (el único): así el filtro por número los encuentra.
UPDATE "conversation" c SET "wa_phone_number_id" = (
  SELECT m."phone_number_id" FROM "meta_credentials" m
  WHERE m."organization_id" = c."organization_id"
  ORDER BY m."created_at", m."id" LIMIT 1
) WHERE c."wa_phone_number_id" IS NULL AND c."channel" = 'whatsapp' AND c."direct_number_id" IS NULL AND c."is_test" = false;
