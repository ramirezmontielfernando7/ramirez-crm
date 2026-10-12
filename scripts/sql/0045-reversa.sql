-- Reversa OPCIONAL de drizzle/0045 (036 PR 3a: límites, avisos, costos e
-- historial). No hace falta para revertir: la 0045 solo agrega tablas y
-- columnas, y la imagen anterior las ignora. Sirve solo para dejar el esquema
-- exactamente como en la 0044.
--
-- BORRA datos: los planes y topes propios de las organizaciones (los de
-- `ai_quota` y `kb_document_limit` no se tocan), los avisos de consumo, los
-- precios de IA capturados, el costo real acumulado y el historial mensual.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0045-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0045, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "organization_plan";
DROP TABLE IF EXISTS "usage_alert";
DROP TABLE IF EXISTS "platform_ai_pricing";
DROP TABLE IF EXISTS "org_usage_monthly";
ALTER TABLE "ai_usage" DROP COLUMN IF EXISTS "cost_usd";
ALTER TABLE "ai_usage_agent" DROP COLUMN IF EXISTS "cost_usd";
COMMIT;
