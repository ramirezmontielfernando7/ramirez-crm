-- Reversa OPCIONAL de drizzle/0046 (038 PR 6: bajas de marketing de Meta y
-- tope de frecuencia de campañas). No hace falta para revertir: la 0046 solo
-- agrega columnas y un índice, y la imagen anterior los ignora. Sirve solo
-- para dejar el esquema exactamente como en la 0045.
--
-- BORRA datos: las marcas 131050 de los contactos y el tope de frecuencia
-- que haya elegido cada organización. Idempotente. Uso (sesión SSH al
-- servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0046-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0046, hay que borrar esa fila para que se re-aplique.
BEGIN;
ALTER TABLE "campaign_settings" DROP CONSTRAINT IF EXISTS "campaign_settings_marketing_min_days_chk";
ALTER TABLE "campaign_settings" DROP COLUMN IF EXISTS "marketing_min_days";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "wa_marketing_opt_out_at";
DROP INDEX IF EXISTS "campaign_recipient_org_contact_sent_idx";
COMMIT;
