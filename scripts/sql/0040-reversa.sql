-- Reversa OPCIONAL de drizzle/0040 (035: Documentos del agente). No hace falta
-- para revertir: la 0040 solo agrega tablas y la imagen anterior las ignora.
-- Sirve solo para dejar el esquema exactamente como en la 0039.
--
-- BORRA datos: todos los documentos subidos en Laboratorio → Documentos, sus
-- fragmentos y los límites propios, de todas las organizaciones. El
-- conocimiento del agente (kb_entry) y Conocimientos (024) no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0040-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0040, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "kb_chunk";
DROP TABLE IF EXISTS "kb_document";
DROP TABLE IF EXISTS "kb_document_limit";
COMMIT;
