import { getSql } from "@/lib/db";
import { logger } from "@/lib/log";

/**
 * Auditoría DF-12 — ¿La app conecta con un usuario que RESPETA el
 * aislamiento entre empresas (RLS)?
 *
 * Las barreras de la base (`FORCE ROW LEVEL SECURITY`, ver docs/rls.md)
 * solo sirven si `DATABASE_URL` usa `vocero_app`. Si apunta a `postgres` (o a
 * cualquier usuario superusuario o con BYPASSRLS), todo funciona igual y
 * `/api/health` se veía sano, pero una consulta con un error ya no tendría
 * la red de seguridad. Al arrancar se comprueba y:
 *
 * - si está bien, no dice nada;
 * - si no, lo grita en el log con el arreglo; con `DB_ROLE_STRICT=true` el
 *   arranque además FALLA (para no atender así). Por defecto solo avisa, para
 *   no tumbar una instalación que todavía no separó sus usuarios.
 *
 * El resultado sale también en `/api/health` (`rls`): `true` = aislamiento
 * activo; `false` = no. Solo un sí/no, sin nombres de usuarios.
 */

type DbRoleCheck = { user: string; superuser: boolean; bypassRls: boolean; safe: boolean };

const log = logger("boot");

const globalForCheck = globalThis as unknown as { __voceroDbRole?: DbRoleCheck | null };

/** El último resultado (null si todavía no se comprobó o falló la consulta). */
export function lastDbRoleCheck(): DbRoleCheck | null {
  return globalForCheck.__voceroDbRole ?? null;
}

export async function checkDbRole(): Promise<DbRoleCheck | null> {
  let row: { user: string; superuser: boolean; bypass: boolean } | undefined;
  try {
    [row] = await getSql()<{ user: string; superuser: boolean; bypass: boolean }[]>`
      select current_user as "user", r.rolsuper as superuser, r.rolbypassrls as bypass
      from pg_roles r where r.rolname = current_user
    `;
  } catch (err) {
    log.error("no se pudo comprobar con qué usuario conecta la app a la base", { err });
    return null;
  }
  if (!row) return null;
  const result: DbRoleCheck = { user: row.user, superuser: row.superuser, bypassRls: row.bypass, safe: !row.superuser && !row.bypass };
  globalForCheck.__voceroDbRole = result;
  if (!result.safe) {
    const msg =
      `DF-12: la app conecta a la base como «${result.user}», que ${result.superuser ? "es superusuario" : "tiene BYPASSRLS"}: ` +
      "el aislamiento entre empresas de la base (RLS) NO está activo. Arreglo: en el entorno pon DATABASE_URL con el usuario " +
      "vocero_app y DATABASE_URL_SYSTEM con vocero_system (y sus contraseñas VOCERO_APP_DB_PASSWORD / VOCERO_SYSTEM_DB_PASSWORD); " +
      "ver docs/roles-de-bd.md.";
    log.error(msg);
    if (process.env.DB_ROLE_STRICT === "true") throw new Error(msg);
  }
  return result;
}
