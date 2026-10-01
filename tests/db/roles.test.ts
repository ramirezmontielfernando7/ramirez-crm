import { describe, expect, it } from "vitest";
import { getSql, getSystemSql } from "@/lib/db";

/**
 * PR 3 multitenant — los roles de la migración 0026 existen con los
 * atributos correctos, y (cuando la prueba corre conectada con ellos, como en
 * CI) la app de verdad no puede hacer DDL ni saltarse RLS.
 */

const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";

/** Igual que SOLO_SISTEMA en scripts/migrate.mjs. */
const SOLO_SISTEMA = ["webhook_unrouted", "platform_admin", "platform_audit_log", "account_link_token"];

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
