-- Reversa OPCIONAL de drizzle/0049 (038 PR 3: análisis guardado por
-- conversación). No hace falta para revertir: la 0049 solo agrega una tabla y
-- la imagen anterior la ignora. Sirve solo para dejar el esquema exactamente
-- como en la 0048.
--
-- BORRA datos: los análisis guardados de las conversaciones (se tendrían que
-- volver a pagar). Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0049-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0049, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "conversation_insight";
COMMIT;
