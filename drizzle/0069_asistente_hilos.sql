-- Asistente: el «Chat general» fijo y los hilos archivables.
--
-- `kind`: 'general' (uno por persona, no se borra ni se archiva) o 'thread'.
-- `archived_at`: el hilo archivado sale de la lista «Hilos» y vive en
-- «Archivados» hasta que se desarchive o se borre. Re-ejecutable.
ALTER TABLE assistant_thread ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'thread';
--> statement-breakpoint
ALTER TABLE assistant_thread ADD COLUMN IF NOT EXISTS archived_at timestamp;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_thread_kind_chk') THEN
    ALTER TABLE assistant_thread ADD CONSTRAINT assistant_thread_kind_chk CHECK (kind in ('general', 'thread'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_thread_general_uq ON assistant_thread (organization_id, user_id) WHERE kind = 'general';
