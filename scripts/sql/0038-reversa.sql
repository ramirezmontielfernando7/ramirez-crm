-- Reversa OPCIONAL de drizzle/0038 (033, PR 2: Notas de «Trabajo»). No hace
-- falta para revertir: la 0038 solo agrega una tabla y la imagen anterior la
-- ignora. Sirve solo para dejar el esquema exactamente como en la 0037.
--
-- BORRA datos: todas las notas de trabajo de todas las organizaciones. Las
-- tareas, las citas y las notas de la línea de tiempo del chat no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0038-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0038, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "work_note";
COMMIT;
