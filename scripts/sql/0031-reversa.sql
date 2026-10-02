-- Reversa OPCIONAL de drizzle/0031 (Campañas v2, PR 1). No hace falta para
-- revertir: la 0031 es aditiva y la imagen anterior ignora lo nuevo. Sirve
-- solo para dejar el esquema exactamente como en la 0030.
-- BORRA datos: historial de salud del número, ajustes de mensajería, horas
-- de estado, precios y componentes de plantillas. Las referencias
-- campaign_recipient.message_id que la 0031 puso en NULL (mensajes que ya no
-- existían) no se recuperan: apuntaban a filas borradas.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0031-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0031, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "wa_phone_health";
DROP TABLE IF EXISTS "messaging_settings";
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_org_message_fk";
DROP INDEX IF EXISTS "campaign_recipient_org_message_idx";
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_org_id_uq";
DROP INDEX IF EXISTS "template_org_wa_template_idx";
ALTER TABLE "template" DROP CONSTRAINT IF EXISTS "template_org_header_media_fk";
ALTER TABLE "message"
  DROP COLUMN IF EXISTS "sent_at",
  DROP COLUMN IF EXISTS "delivered_at",
  DROP COLUMN IF EXISTS "read_at",
  DROP COLUMN IF EXISTS "failed_at",
  DROP COLUMN IF EXISTS "error_code",
  DROP COLUMN IF EXISTS "pricing_billable",
  DROP COLUMN IF EXISTS "pricing_category",
  DROP COLUMN IF EXISTS "pricing_model",
  DROP COLUMN IF EXISTS "pricing_type";
ALTER TABLE "template"
  DROP COLUMN IF EXISTS "components",
  DROP COLUMN IF EXISTS "meta_status",
  DROP COLUMN IF EXISTS "paused_reason",
  DROP COLUMN IF EXISTS "quality_score",
  DROP COLUMN IF EXISTS "previous_category",
  DROP COLUMN IF EXISTS "category_changed_at",
  DROP COLUMN IF EXISTS "category_change_seen_at",
  DROP COLUMN IF EXISTS "synced_at",
  DROP COLUMN IF EXISTS "upcoming_category",
  DROP COLUMN IF EXISTS "upcoming_category_at",
  DROP COLUMN IF EXISTS "header_media_asset_id";
COMMIT;
