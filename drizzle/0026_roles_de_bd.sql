-- Fase 1 multitenant, PR 3 (H5, primera parte): roles de base de datos.
--
--   * dueño del esquema (quien corre esta migración, hoy `postgres`): solo
--     migraciones. La app deja de conectarse con él en cuanto el operador
--     cambia DATABASE_URL (pasos en docs/roles-de-bd.md).
--   * vocero_app: la app atendiendo a una persona. Sin BYPASSRLS, sin ser
--     dueño de nada: solo SELECT/INSERT/UPDATE/DELETE. En el PR 4, RLS lo
--     limita a la organización de `app.org_id`.
--   * vocero_system: el enrutamiento del webhook, el arranque, better-auth y
--     la administración de plataforma. BYPASSRLS porque su trabajo es,
--     justamente, averiguar de qué organización es algo.
--
-- Se crean NOLOGIN y SIN contraseña: ninguna contraseña vive en el repo. La
-- activa `scripts/migrate.mjs` con VOCERO_APP_DB_PASSWORD y
-- VOCERO_SYSTEM_DB_PASSWORD si están definidas.
--
-- Idempotente: se puede correr dos veces y sobre una base que ya lo tiene.
-- Los roles son del SERVIDOR (no de la base): si ya existen porque otra base
-- del mismo Postgres los creó, o porque el operador los creó a mano, se
-- reutilizan y solo se corrigen sus atributos.
-- Reversa: scripts/sql/0026-reversa.sql.

DO $$
DECLARE
  es_super boolean;
BEGIN
  SELECT rolsuper INTO es_super FROM pg_roles WHERE rolname = current_user;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vocero_app') THEN
    CREATE ROLE vocero_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vocero_system') THEN
    IF NOT es_super THEN
      RAISE EXCEPTION 'vocero_system no existe y % no es superusuario (BYPASSRLS lo exige). Créalo a mano como superusuario: CREATE ROLE vocero_system NOLOGIN BYPASSRLS; y vuelve a desplegar.', current_user;
    END IF;
    CREATE ROLE vocero_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOINHERIT;
  END IF;

  -- vocero_app jamás puede saltarse RLS: si alguien lo creó a mano con más
  -- poder, se le quita (o se aborta si no hay con qué).
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'vocero_app' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
  ) THEN
    IF NOT es_super THEN
      RAISE EXCEPTION 'vocero_app tiene SUPERUSER, BYPASSRLS, CREATEROLE o CREATEDB; quítaselos como superusuario y vuelve a desplegar.';
    END IF;
    ALTER ROLE vocero_app NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;
END
$$;
--> statement-breakpoint

-- Solo datos, nunca DDL. TRUNCATE tampoco: la app no lo usa y salta RLS.
GRANT USAGE ON SCHEMA public TO vocero_app, vocero_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vocero_app, vocero_system;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vocero_app, vocero_system;
--> statement-breakpoint

-- Las tablas que creen las migraciones futuras (con este mismo dueño) nacen
-- con los mismos permisos. Además `migrate.mjs` repite los GRANT de arriba
-- tras cada despliegue, por si el dueño cambiara.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vocero_app, vocero_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vocero_app, vocero_system;
