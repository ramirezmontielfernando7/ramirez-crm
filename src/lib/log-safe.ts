/**
 * Describe un error para los logs SIN datos sensibles (constitución I).
 *
 * Desde drizzle-orm 0.44 todo error del driver llega envuelto en
 * `DrizzleQueryError`, cuyo `message` trae el SQL completo y sus parámetros
 * (teléfonos, textos de mensajes, credenciales cifradas). Y el error de
 * Postgres trae en `detail` los valores de la llave que chocó. Aquí de un
 * error de base solo sale lo que sirve para diagnosticar: el código SQLSTATE,
 * la tabla y la restricción. De cualquier otro error, su nombre y un mensaje
 * recortado, sin stack ni objetos anidados.
 */

const MAX_MESSAGE = 200;

type PgLike = {
  code?: unknown;
  table_name?: unknown;
  constraint_name?: unknown;
  severity?: unknown;
};

/** ¿Es el error de un query (drizzle) o del driver de Postgres? */
function isDbError(err: object): boolean {
  if ("query" in err && "params" in err) return true; // DrizzleQueryError
  const e = err as PgLike;
  return typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && "severity" in err;
}

function describeDb(err: object): string {
  const cause = (err as { cause?: unknown }).cause;
  const pg = (typeof cause === "object" && cause !== null ? cause : err) as PgLike;
  const parts = [`código ${typeof pg.code === "string" ? pg.code : "desconocido"}`];
  if (typeof pg.table_name === "string") parts.push(`tabla ${pg.table_name}`);
  if (typeof pg.constraint_name === "string") parts.push(`restricción ${pg.constraint_name}`);
  return `error de base de datos (${parts.join(", ")})`;
}

export function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return typeof err === "string" ? recortar(err) : String(err);
  }
  if (isDbError(err)) return describeDb(err);
  const name = err instanceof Error ? err.name : "Error";
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? `${name}: ${recortar(message)}` : name;
}

function recortar(s: string): string {
  const linea = s.split("\n")[0] ?? "";
  return linea.length > MAX_MESSAGE ? `${linea.slice(0, MAX_MESSAGE)}…` : linea;
}
