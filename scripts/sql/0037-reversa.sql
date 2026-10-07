-- Reversa OPCIONAL de drizzle/0037 (033, PR 1: módulo «Trabajo», Tareas). No
-- hace falta para revertir: la 0037 solo agrega una tabla y una columna y la
-- imagen anterior las ignora (el menú vuelve a decir «Citas»). Sirve solo
-- para dejar el esquema exactamente como en la 0036.
--
-- BORRA datos: todas las tareas de todas las organizaciones y el interruptor
-- «Tareas y notas» de /platform. Las citas no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0037-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0037, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "work_task";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "trabajo";
COMMIT;
