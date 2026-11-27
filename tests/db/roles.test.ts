import { describe, expect, it } from "vitest";
import { getSql, getSystemSql } from "@/lib/db";

/**
 * PR 3 multitenant — los roles de la migración 0026 existen con los
 * atributos correctos, y (cuando la prueba corre conectada con ellos, como en
 * CI) la app de verdad no puede hacer DDL ni saltarse RLS.
 */

const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";

/** Igual que SOLO_SISTEMA en scripts/migrate.mjs. */
const SOLO_SISTEMA = [
  "webhook_unrouted", "webhook_inbox", "platform_admin", "platform_audit_log", "account_link_token", "evolution_server",
  "ai_oauth_client", "platform_ai_defaults", "platform_ai_model_price", "platform_plan_catalog", "platform_setting",
  // Auditoría 2026-11: better-auth y controles de plataforma.
  "session", "account", "verification", "platform_kill_switch", "platform_broadcast", "platform_ai_pricing",
];

/** Igual que SOLO_LECTURA_APP en scripts/migrate.mjs. */
const SOLO_LECTURA_APP = ["user"];

describe("roles de base de datos (0026)", () => {
  it("vocero_app no es superusuario ni salta RLS; vocero_system sí salta RLS", async () => {
    const filas = await getSystemSql()<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]>`
      select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      from pg_roles where rolname in ('vocero_app', 'vocero_system') order by rolname
    `;
    expect(filas).toEqual([
      { rolname: "vocero_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
      { rolname: "vocero_system", rolsuper: false, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false },
    ]);
  });

  it("los dos roles pueden leer y escribir todas las tablas de public (salvo las solo de sistema)", async () => {
    const [fila] = await getSystemSql()<{ faltan: string[] }[]>`
      select coalesce(array_agg(t.tablename::text || ' ' || r.rol), '{}') as faltan
      from pg_tables t
      cross join (values ('vocero_app'), ('vocero_system')) as r(rol)
      where t.schemaname = 'public'
        and not (r.rol = 'vocero_app' and t.tablename = any(${SOLO_SISTEMA}))
        and not (r.rol = 'vocero_app' and t.tablename = any(${SOLO_LECTURA_APP}))
        and not (
          has_table_privilege(r.rol, format('public.%I', t.tablename), 'select')
          and has_table_privilege(r.rol, format('public.%I', t.tablename), 'insert')
          and has_table_privilege(r.rol, format('public.%I', t.tablename), 'update')
          and has_table_privilege(r.rol, format('public.%I', t.tablename), 'delete')
        )
    `;
    expect(fila?.faltan).toEqual([]);
  });

  it("Fase 3: vocero_app no tiene NINGÚN permiso sobre las tablas solo de sistema", async () => {
    const [fila] = await getSystemSql()<{ con: string[] }[]>`
      select coalesce(array_agg(t.tablename::text), '{}') as con
      from pg_tables t
      where t.schemaname = 'public' and t.tablename = any(${SOLO_SISTEMA})
        and (has_table_privilege('vocero_app', format('public.%I', t.tablename), 'select')
          or has_table_privilege('vocero_app', format('public.%I', t.tablename), 'insert'))
    `;
    expect(fila?.con).toEqual([]);
  });

  it("Auditoría 2026-11: vocero_app lee `user` pero no puede escribirla", async () => {
    const filas = await getSystemSql()<{ tabla: string; leer: boolean; escribir: boolean }[]>`
      select t.tablename::text as tabla,
        has_table_privilege('vocero_app', format('public.%I', t.tablename), 'select') as leer,
        (has_table_privilege('vocero_app', format('public.%I', t.tablename), 'insert')
          or has_table_privilege('vocero_app', format('public.%I', t.tablename), 'update')
          or has_table_privilege('vocero_app', format('public.%I', t.tablename), 'delete')) as escribir
      from pg_tables t
      where t.schemaname = 'public' and t.tablename = any(${SOLO_LECTURA_APP})
      order by 1
    `;
    expect(filas).toEqual(SOLO_LECTURA_APP.map((tabla) => ({ tabla, leer: true, escribir: false })));
  });

  it("Auditoría 2026-11: topes de tiempo por rol (transacciones olvidadas, consultas desbocadas)", async () => {
    const filas = await getSystemSql()<{ rol: string; config: string[] }[]>`
      select r.rolname as rol, coalesce(s.setconfig, '{}') as config
      from pg_roles r left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0
      where r.rolname in ('vocero_app', 'vocero_system') order by 1
    `;
    const app = filas.find((f) => f.rol === "vocero_app")?.config ?? [];
    const sys = filas.find((f) => f.rol === "vocero_system")?.config ?? [];
    expect(app).toEqual(expect.arrayContaining(["statement_timeout=120s", "idle_in_transaction_session_timeout=300s"]));
    expect(sys).toEqual(expect.arrayContaining(["idle_in_transaction_session_timeout=300s"]));
    expect(sys.some((c) => c.startsWith("statement_timeout="))).toBe(false);
  });

  it("ninguno de los dos puede hacer TRUNCATE ni es dueño de nada", async () => {
    const [fila] = await getSystemSql()<{ truncate: number; duenos: number }[]>`
      select
        (select count(*)::int from pg_tables t, (values ('vocero_app'), ('vocero_system')) r(rol)
          where t.schemaname = 'public' and has_table_privilege(r.rol, format('public.%I', t.tablename), 'truncate')) as truncate,
        (select count(*)::int from pg_tables where schemaname = 'public' and tableowner in ('vocero_app', 'vocero_system')) as duenos
    `;
    expect(fila).toEqual({ truncate: 0, duenos: 0 });
  });

  it.skipIf(!usaRoles)("conectada como vocero_app, la app no puede crear tablas", async () => {
    const [yo] = await getSql()<{ u: string }[]>`select current_user as u`;
    expect(yo?.u).toBe("vocero_app");
    await expect(getSql().unsafe("create table no_deberia (id int)")).rejects.toThrow(/permission denied/);
  });
});
