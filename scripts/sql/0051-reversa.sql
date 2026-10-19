-- Reversa OPCIONAL de drizzle/0051 (041: chats de campaña fuera de la
-- Bandeja principal). No hace falta para revertir: la 0051 solo agrega dos
-- columnas y un índice, y la imagen anterior los ignora (con la imagen
-- anterior, los chats de campaña vuelven a verse en la Bandeja principal).
-- Sirve solo para dejar el esquema exactamente como en la 0050.
--
-- BORRA datos: qué chats esperan respuesta de una campaña y a qué campaña
-- respondió cada uno. Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0051-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0051, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP INDEX IF EXISTS "conversation_org_campaign_pending_idx";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "campaign_replied_id";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "campaign_pending_id";
COMMIT;
