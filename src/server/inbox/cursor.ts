/**
 * Fluidez PR 3 — Cursor de la Bandeja paginada (opaco para el navegador).
 *
 * Es la llave de orden de la última fila TAL COMO la guarda Postgres
 * (microsegundos; un `Date` de JS los perdería y repetiría o saltaría filas)
 * más su id, para desempatar.
 */
export type Cursor = { key: string; id: string };

const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.key}|${c.id}`, "utf8").toString("base64url");
}

/** null = no vino; "invalid" = no es un cursor nuestro (la ruta responde 422). */
export function decodeCursor(value: string | null): Cursor | null | "invalid" {
  if (value == null || value === "") return null;
  if (value.length > 200) return "invalid";
  const raw = Buffer.from(value, "base64url").toString("utf8");
  const i = raw.lastIndexOf("|");
  if (i < 0) return "invalid";
  const key = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!PG_TIMESTAMP.test(key) || !ID_RE.test(id)) return "invalid";
  return { key, id };
}
