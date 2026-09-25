import { asc, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isTagColor, normalizeTagName, type TagDto } from "@/lib/tags";

/**
 * 021 — Etiquetas de contacto.
 *
 * Todo aquí recibe el `organizationId` y filtra con `scoped()`: una etiqueta
 * es del negocio (no de un cliente), así que no pasa por el filtro de
 * asignación. Lo que SÍ es de un cliente —qué contacto lleva qué etiqueta—
 * lo escribe `setContactTags`, y la ruta verifica antes que la sesión pueda
 * ver ese contacto.
 */

export class TagError extends Error {
  code: "invalid" | "duplicate" | "not_found";
  constructor(code: TagError["code"], message: string) {
    super(message);
    this.name = "TagError";
    this.code = code;
  }
}

export const TAG_ERROR_STATUS: Record<TagError["code"], number> = {
  invalid: 422,
  duplicate: 409,
  not_found: 404,
};

type TagRow = typeof schema.contactTag.$inferSelect;

export function serializeTag(t: TagRow, contactCount?: number): TagDto {
  return {
    id: t.id,
    name: t.name,
    color: isTagColor(t.color) ? t.color : null,
    ...(contactCount !== undefined ? { contactCount } : {}),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/** Todas las etiquetas del negocio, con cuántos contactos lleva cada una. */
export async function listTags(organizationId: string): Promise<TagDto[]> {
  const db = getDb();
  const [tags, counts] = await Promise.all([
    db
      .select()
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId))
      .orderBy(asc(schema.contactTag.name)),
    db
      .select({ tagId: schema.contactTagAssignment.tagId, n: count() })
      .from(schema.contactTagAssignment)
      .where(scoped(schema.contactTagAssignment.organizationId, organizationId))
      .groupBy(schema.contactTagAssignment.tagId),
  ]);
  const byTag = new Map(counts.map((c) => [c.tagId, Number(c.n)]));
  return tags.map((t) => serializeTag(t, byTag.get(t.id) ?? 0));
}

export async function createTag(
  organizationId: string,
  input: { name: string; color?: string | null }
): Promise<TagDto> {
  const name = normalizeTagName(input.name);
  if (!name) throw new TagError("invalid", "El nombre de la etiqueta es obligatorio (máx. 60 caracteres)");
  const color = input.color == null ? null : isTagColor(input.color) ? input.color : undefined;
  if (color === undefined) throw new TagError("invalid", "Color de etiqueta no válido");
  try {
    const inserted = await getDb()
      .insert(schema.contactTag)
      .values({ id: newId("contactTag"), organizationId, name, color })
      .returning();
    return serializeTag(inserted[0]!, 0);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TagError("duplicate", `Ya existe una etiqueta llamada "${name}"`);
    }
    throw err;
  }
}

export async function updateTag(
  organizationId: string,
  tagId: string,
  input: { name?: string; color?: string | null }
): Promise<TagDto> {
  const set: Partial<typeof schema.contactTag.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = normalizeTagName(input.name);
    if (!name) throw new TagError("invalid", "El nombre de la etiqueta es obligatorio (máx. 60 caracteres)");
    set.name = name;
  }
  if (input.color !== undefined) {
    if (input.color !== null && !isTagColor(input.color)) {
      throw new TagError("invalid", "Color de etiqueta no válido");
    }
    set.color = input.color;
  }
  if (Object.keys(set).length === 0) throw new TagError("invalid", "Nada que cambiar");
  try {
    const updated = await getDb()
      .update(schema.contactTag)
      .set(set)
      .where(scoped(schema.contactTag.organizationId, organizationId, eq(schema.contactTag.id, tagId)))
      .returning();
    if (!updated[0]) throw new TagError("not_found", "Etiqueta no encontrada");
    return serializeTag(updated[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TagError("duplicate", `Ya existe una etiqueta llamada "${set.name}"`);
    }
    throw err;
  }
}

/** Borra la etiqueta y (por cascada) sus asignaciones. Los contactos quedan. */
export async function deleteTag(organizationId: string, tagId: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.contactTag)
    .where(scoped(schema.contactTag.organizationId, organizationId, eq(schema.contactTag.id, tagId)))
    .returning({ id: schema.contactTag.id });
  if (!deleted[0]) throw new TagError("not_found", "Etiqueta no encontrada");
}

/**
 * La etiqueta con ese nombre, creándola si no existe (importación). Idempotente
 * frente a dos importaciones simultáneas gracias al índice único.
 */
export async function ensureTag(organizationId: string, rawName: string): Promise<TagDto> {
  const name = normalizeTagName(rawName);
  if (!name) throw new TagError("invalid", `Nombre de etiqueta no válido: "${rawName.slice(0, 80)}"`);
  const db = getDb();
  await db
    .insert(schema.contactTag)
    .values({ id: newId("contactTag"), organizationId, name })
    .onConflictDoNothing({ target: [schema.contactTag.organizationId, schema.contactTag.name] });
  const rows = await db
    .select()
    .from(schema.contactTag)
    .where(scoped(schema.contactTag.organizationId, organizationId, eq(schema.contactTag.name, name)))
    .limit(1);
  if (!rows[0]) throw new Error(`ensureTag: la etiqueta "${name}" no quedó creada`);
  return serializeTag(rows[0]);
}

/** Etiquetas de varios contactos a la vez: contactId → etiquetas (por nombre). */
export async function tagsForContacts(
  organizationId: string,
  contactIds: string[]
): Promise<Map<string, TagDto[]>> {
  const out = new Map<string, TagDto[]>();
  if (contactIds.length === 0) return out;
  const rows = await getDb()
    .select({ contactId: schema.contactTagAssignment.contactId, tag: schema.contactTag })
    .from(schema.contactTagAssignment)
    .innerJoin(schema.contactTag, eq(schema.contactTag.id, schema.contactTagAssignment.tagId))
    .where(
      scoped(
        schema.contactTagAssignment.organizationId,
        organizationId,
        inArray(schema.contactTagAssignment.contactId, contactIds)
      )
    )
    .orderBy(asc(schema.contactTag.name));
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(serializeTag(r.tag));
    out.set(r.contactId, list);
  }
  return out;
}

/**
 * Deja al contacto EXACTAMENTE con estas etiquetas. Quien llama ya verificó
 * que la sesión ve al contacto; aquí se verifica que las etiquetas sean del
 * negocio (un id ajeno sería 404, no una asignación cruzada de tenants).
 */
export async function setContactTags(
  organizationId: string,
  contactId: string,
  tagIds: string[]
): Promise<TagDto[]> {
  const unique = [...new Set(tagIds)];
  const db = getDb();
  if (unique.length > 0) {
    const found = await db
      .select({ id: schema.contactTag.id })
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId, inArray(schema.contactTag.id, unique)));
    if (found.length !== unique.length) throw new TagError("not_found", "Alguna etiqueta no existe");
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.contactTagAssignment)
      .where(
        scoped(
          schema.contactTagAssignment.organizationId,
          organizationId,
          eq(schema.contactTagAssignment.contactId, contactId)
        )
      );
    if (unique.length > 0) {
      await tx
        .insert(schema.contactTagAssignment)
        .values(unique.map((tagId) => ({ organizationId, contactId, tagId })))
        .onConflictDoNothing();
    }
  });
  return (await tagsForContacts(organizationId, [contactId])).get(contactId) ?? [];
}

/** Agrega (sin quitar) una etiqueta a muchos contactos: la usa la importación. */
export async function addTagToContacts(
  organizationId: string,
  tagId: string,
  contactIds: string[]
): Promise<void> {
  const db = getDb();
  for (let i = 0; i < contactIds.length; i += 500) {
    const chunk = contactIds.slice(i, i + 500);
    await db
      .insert(schema.contactTagAssignment)
      .values(chunk.map((contactId) => ({ organizationId, contactId, tagId })))
      .onConflictDoNothing();
  }
}
