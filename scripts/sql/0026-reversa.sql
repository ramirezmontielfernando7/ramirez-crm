-- Reversa de drizzle/0026_roles_de_bd.sql. Idempotente; como superusuario:
--   psql -U postgres -d vocero -f scripts/sql/0026-reversa.sql
--
-- ANTES de correrla, la app debe volver a conectarse con `postgres`
-- (DATABASE_URL y DATABASE_URL_SYSTEM → el usuario postgres): si no, pierde
-- la conexión. Los roles son del SERVIDOR: si otra base del mismo Postgres
-- los usa, DROP ROLE falla y no se borra nada (se avisa).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vocero_app', 'vocero_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r);
      BEGIN
        EXECUTE format('DROP ROLE %I', r);
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE NOTICE '% sigue con permisos en otra base de este servidor: no se borra', r;
      END;
    END IF;
  END LOOP;
END
$$;
