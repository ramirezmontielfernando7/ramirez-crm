import { apiError, forbidden } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { parseExtraTagFields, type ImportExtraTag } from "@/lib/import-tag";

/**
 * La etiqueta «para todos los contactos de esta base», leída del formulario de
 * una importación. Elegir una existente va con los permisos de importación;
 * CREAR una nueva exige `tags.manage` (el mismo permiso que crear etiquetas):
 * 403 aquí, antes de tocar la base de datos.
 */
export function extraTagFromForm(
  session: Pick<SessionContext, "role" | "grants">,
  form: FormData
): { ok: true; tag: ImportExtraTag | null } | { ok: false; response: Response } {
  const parsed = parseExtraTagFields({
    id: form.get("extraTagId"),
    name: form.get("extraTagName"),
    color: form.get("extraTagColor"),
  });
  if (!parsed.ok) return { ok: false, response: apiError(422, "invalid", parsed.error) };
  if (parsed.tag?.kind === "new" && !can(session, "tags.manage")) return { ok: false, response: forbidden() };
  return { ok: true, tag: parsed.tag };
}
