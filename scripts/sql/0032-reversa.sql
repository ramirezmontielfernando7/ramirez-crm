-- Reversa OPCIONAL de drizzle/0032 (Campañas v2, PR 2). No hace falta para
-- revertir: la 0032 es aditiva y la imagen anterior ignora lo nuevo (solo
-- reanuda campañas en `sending`; las pausadas, programadas o canceladas se
-- quedan quietas). Sirve solo para dejar el esquema exactamente como en la
-- 0031.
--
-- BORRA datos: bases subidas (audiencias) y sus miembros, correos de los
-- contactos, ajustes de envío, programación, costos estimados y excluidos.
-- Antes de borrar columnas deja los estados nuevos en los que entiende el
-- código anterior: campañas `scheduled`/`paused`/`cancelled` → `failed` (con
-- el motivo), destinatarios `sending`/`skipped` → `failed`.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0032-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0032, hay que borrar esa fila para que se re-aplique.
BEGIN;
UPDATE "campaign"
SET "status" = 'failed',
    "error" = coalesce("error", CASE "status"
      WHEN 'scheduled' THEN 'Programada; se detuvo al revertir la versión'
      WHEN 'paused' THEN 'En pausa; se detuvo al revertir la versión'
      ELSE 'Cancelada' END),
    "finished_at" = coalesce("finished_at", now())
WHERE "status" IN ('scheduled', 'paused', 'cancelled');
UPDATE "campaign_recipient"
SET "status" = 'failed',
    "error_message" = coalesce("error_message", 'No se envió (versión revertida)')
WHERE "status" IN ('sending', 'skipped');
DROP TABLE IF EXISTS "audience_member";
DROP TABLE IF EXISTS "audience_import";
DROP TABLE IF EXISTS "campaign_settings";
DROP TABLE IF EXISTS "wa_send_lease";
DROP INDEX IF EXISTS "contact_org_email_idx";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "email";
ALTER TABLE "campaign"
  DROP COLUMN IF EXISTS "scheduled_at",
  DROP COLUMN IF EXISTS "phone_number_id",
  DROP COLUMN IF EXISTS "pause_reason",
  DROP COLUMN IF EXISTS "auto_paused",
  DROP COLUMN IF EXISTS "resume_at",
  DROP COLUMN IF EXISTS "estimated_cost",
  DROP COLUMN IF EXISTS "cost_currency",
  DROP COLUMN IF EXISTS "excluded",
  DROP COLUMN IF EXISTS "test_sent_at";
ALTER TABLE "campaign_recipient"
  DROP COLUMN IF EXISTS "claimed_at",
  DROP COLUMN IF EXISTS "claimed_by",
  DROP COLUMN IF EXISTS "attempts",
  DROP COLUMN IF EXISTS "next_attempt_at",
  DROP COLUMN IF EXISTS "variables",
  DROP COLUMN IF EXISTS "error_code";
COMMIT;
