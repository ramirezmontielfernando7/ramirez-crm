-- Reversa OPCIONAL de drizzle/0036 (031, PR B: agentes por etapa). No hace
-- falta para revertir: la 0036 solo agrega una tabla y una columna y la imagen
-- anterior las ignora (atiende siempre el agente general). Sirve solo para
-- dejar el esquema exactamente como en la 0035.
--
-- BORRA datos: qué agente atiende cada etapa, el «último agente» de cada
-- conversación y las líneas «Cambió el agente que atiende» de la línea de
-- tiempo. Los agentes, sus versiones y su conocimiento no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0036-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0036, hay que borrar esa fila para que se re-aplique.
BEGIN;
DELETE FROM "contact_activity_event" WHERE "kind" = 'agent_changed';
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_org_last_agent_fk";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "last_agent_id";
DROP TABLE IF EXISTS "agent_stage_assignment";
COMMIT;
