-- Reversa OPCIONAL de drizzle/0034 (Campañas v2, PR 4). No hace falta para
-- revertir: la 0034 solo agrega columnas y tablas y la imagen anterior las
-- ignora. Sirve solo para dejar el esquema exactamente como en la 0033.
--
-- BORRA datos: los menús personalizados por rol (nav_layout), su bitácora y
-- los interruptores nuevos de organization_module (knowledge, lab, agent,
-- team_chat, results, custom_nav). Las columnas de la 0030 no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0034-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0034, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "nav_layout_event";
DROP TABLE IF EXISTS "nav_layout";
DROP FUNCTION IF EXISTS nav_layout_event_append_only();
ALTER TABLE "organization_module" DROP CONSTRAINT IF EXISTS "organization_module_lab_requires_agent_chk";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "knowledge";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "lab";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "agent";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "team_chat";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "results";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "custom_nav";
COMMIT;
