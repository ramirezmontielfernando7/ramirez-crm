-- Reversa OPCIONAL de drizzle/0056 (Costos y Precios IA). No hace falta para
-- revertir el código: la imagen anterior ignora las columnas nuevas. Sirve
-- para dejar el esquema como en la 0055. Las filas SIN tipo de cambio se
-- BORRAN (la columna volvería a ser obligatoria); el resto del historial queda.
-- Idempotente. Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0056-reversa.sql
BEGIN;
DELETE FROM "platform_ai_pricing" WHERE "usd_to_local" IS NULL;
ALTER TABLE "platform_ai_pricing" ALTER COLUMN "usd_to_local" SET NOT NULL;
ALTER TABLE "platform_ai_pricing" DROP COLUMN IF EXISTS "analysis_input_usd_per_mtok";
ALTER TABLE "platform_ai_pricing" DROP COLUMN IF EXISTS "analysis_output_usd_per_mtok";
COMMIT;
