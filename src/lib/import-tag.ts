import { isTagColor, normalizeTagName, type TagColor } from "@/lib/tags";

/**
 * Etiqueta opcional «para todos los contactos de esta base» (Audiencias).
 * Independiente del nombre de la base y de la etiqueta automática
 * «Import: archivo»: se SUMA a ellas y a las de cada fila.
 */
export type ImportExtraTag =
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; color: TagColor | null };

/**
 * Lee la etiqueta extra de los campos del formulario. Vacío → `null` (todo
 * funciona como antes). Un nombre o color inválido devuelve `error`, con las
 * mismas reglas que crear una etiqueta (`normalizeTagName`, `isTagColor`).
 */
export function parseExtraTagFields(fields: {
  id?: unknown;
  name?: unknown;
  color?: unknown;
}): { ok: true; tag: ImportExtraTag | null } | { ok: false; error: string } {
  const id = typeof fields.id === "string" ? fields.id.trim() : "";
  const rawName = typeof fields.name === "string" ? fields.name : "";
  if (id) return { ok: true, tag: { kind: "existing", id: id.slice(0, 64) } };
  if (!rawName.trim()) return { ok: true, tag: null };
  const name = normalizeTagName(rawName);
  if (!name) return { ok: false, error: "El nombre de la etiqueta es obligatorio (máx. 60 caracteres)" };
  const rawColor = typeof fields.color === "string" ? fields.color.trim() : "";
  if (rawColor && !isTagColor(rawColor)) return { ok: false, error: "Color de etiqueta no válido" };
  return { ok: true, tag: { kind: "new", name, color: rawColor ? (rawColor as TagColor) : null } };
}

/** Las etiquetas que hay que asegurar al importar: la automática y las de cada fila, sin repetir. */
export function collectImportTagNames(autoName: string, rowTags: string[][]): string[] {
  const out = new Set<string>([autoName]);
  for (const tags of rowTags) for (const t of tags) out.add(t);
  return [...out];
}

/** Las etiquetas (ids) de un contacto de la importación: automática + filas + extra, sin repetir. */
export function tagIdsForMember(
  autoId: string,
  rowTagIds: string[],
  extraId: string | null
): string[] {
  return [...new Set([autoId, ...rowTagIds, ...(extraId ? [extraId] : [])])];
}
