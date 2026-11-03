import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Auditoría DF-18 — Fecha que solo AVANZA: el valor nuevo solo gana si es
 * más reciente que el guardado. Un mensaje que llega tarde (Meta no
 * garantiza el orden) ya no hace retroceder la última entrada del chat ni
 * cierra antes de tiempo la ventana de 24 h.
 *
 * Texto + cast: las columnas son `timestamp` en UTC (ver schema.ts).
 */
export function latest(column: AnyColumn, value: Date): SQL {
  const iso = value.toISOString();
  return sql`greatest(coalesce(${column}, ${iso}::timestamp), ${iso}::timestamp)`;
}
