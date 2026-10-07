-- 034 — Bandeja: archivar conversaciones.
--
-- `conversation.archived_at`: NULL = a la vista; con fecha = archivada (fuera
-- de la Bandeja principal, conservada con todo su historial). Un mensaje
-- entrante la desarchiva (ingest). Eliminar de verdad no necesita SQL: la FK
-- de `message` ya borra en cascada.
--
-- Solo aditiva: el código anterior ignora la columna. Idempotente: re-ejecutable
-- sobre una base ya migrada. La tabla ya tiene RLS forzado (0027).
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_archived_idx" ON "conversation" USING btree ("organization_id","archived_at");
