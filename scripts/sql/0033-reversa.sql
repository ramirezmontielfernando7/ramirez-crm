-- Reversa OPCIONAL de drizzle/0033 (Campañas v2, PR 3). No hace falta para
-- revertir: la 0033 solo agrega tablas y la imagen anterior las ignora.
-- Sirve solo para dejar el esquema exactamente como en la 0032.
--
-- BORRA datos: las analíticas de Meta copiadas (plantillas y precios). Se
-- vuelven a traer solas (90 días y 1 año) si después se despliega otra vez
-- el código con la 0033.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0033-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0033, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "wa_template_analytics_daily";
DROP TABLE IF EXISTS "wa_pricing_analytics_daily";
DROP TABLE IF EXISTS "wa_analytics_sync";
COMMIT;
