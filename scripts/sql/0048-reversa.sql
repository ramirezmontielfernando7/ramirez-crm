-- Reversa OPCIONAL de drizzle/0048 (038 PR 2: motor del asistente interno). No
-- hace falta para revertir: la 0048 solo agrega dos columnas NULL y un CHECK,
-- y la imagen anterior los ignora. Sirve solo para dejar el esquema
-- exactamente como en la 0047.
--
-- BORRA datos: las fuentes de las respuestas del asistente y el texto
-- enmascarado de sus conversaciones (las conversaciones se conservan).
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0048-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0048, hay que borrar esa fila para que se re-aplique.
BEGIN;
ALTER TABLE "assistant_message" DROP CONSTRAINT IF EXISTS "assistant_message_masked_chk";
ALTER TABLE "assistant_message" DROP COLUMN IF EXISTS "sources";
ALTER TABLE "assistant_message" DROP COLUMN IF EXISTS "masked_content";
COMMIT;
