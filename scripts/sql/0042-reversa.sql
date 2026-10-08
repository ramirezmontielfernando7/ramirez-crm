-- Reversa OPCIONAL de drizzle/0042 (036 PR 1: consumo de IA por agente). No
-- hace falta para revertir: la 0042 solo agrega una tabla y la imagen
-- anterior la ignora. Sirve solo para dejar el esquema exactamente como en la
-- 0041.
--
-- BORRA datos: el desglose de consumo por agente de todas las organizaciones.
-- `ai_usage` (consumo por organización y tipo) y `ai_quota` no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0042-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0042, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "ai_usage_agent";
COMMIT;
