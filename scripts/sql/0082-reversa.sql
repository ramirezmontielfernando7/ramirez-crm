-- Solo después de volver al código anterior y respaldar los datos.
BEGIN;
DROP TABLE IF EXISTS "message_reaction";
ALTER TABLE "message" DROP COLUMN IF EXISTS "reply_to_wa_message_id";
COMMIT;
