-- better-auth 1.7 revisa al arrancar que cada tabla tenga las columnas de su
-- modelo y exige `invitation.created_at`. Vocero no usa invitaciones (la API
-- del plugin de organización está cerrada, H3), así que solo se agrega la
-- columna. Hereda el RLS de `invitation`; sin tablas ni políticas nuevas.
ALTER TABLE invitation ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now() NOT NULL;
