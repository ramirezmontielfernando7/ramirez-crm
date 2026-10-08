import { asc, count, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { logActivities, logActivitySafe } from "@/server/activity/log";
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
  code: "invalid" | "duplicate" | "not_found" | "system_target";
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
  system_target: 409,
};

type TagRow = typeof schema.contactTag.$inferSelect;

export function serializeTag(t: TagRow, contactCount?: number): TagDto {
  return {
    id: t.id,
    name: t.name,
    color: isTagColor(t.color) ? t.color : null,
    ...(t.systemOrigin ? { system: true } : {}),
    ...(contactCount !== undefined ? { contactCount } : {}),
  };
}

/** 23505 = unique_violation de Postgres. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  // Drizzle (≥ 0.44) envuelve el error del driver: el código real viaja en `cause`.
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  );
}

/**
 * Qué etiquetas se listan. Por defecto SOLO las normales: las de sistema (la
 * automática «Import: archivo») no se muestran en selectores, filtros ni
 * cápsulas. `include` = todas; `only` = solo las de sistema (Ajustes y
 * Audiencias).
 */
export type SystemTagScope = "exclude" | "include" | "only";

function systemFilter(scope: SystemTagScope) {
  if (scope === "only") return isNotNull(schema.contactTag.systemOrigin);
  if (scope === "exclude") return isNull(schema.contactTag.systemOrigin);
  return undefined;
}

/** Todas las etiquetas del negocio, con cuántos contactos lleva cada una. */
export async function listTags(
  organizationId: string,
  opts: { system?: SystemTagScope } = {}
): Promise<TagDto[]> {
  const db = getDb();
  const filter = systemFilter(opts.system ?? "exclude");
  const [tags, counts] = await Promise.all([
    db
      .select()
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId, ...(filter ? [filter] : [])))
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
  contactIds: string[],
  opts: { includeSystem?: boolean } = {}
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
        inArray(schema.contactTagAssignment.contactId, contactIds),
        ...(opts.includeSystem ? [] : [isNull(schema.contactTag.systemOrigin)])
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
  tagIds: string[],
  /** 022 — quién etiqueta, para la línea de tiempo. */
  actorUserId: string | null = null
): Promise<TagDto[]> {
  const unique = [...new Set(tagIds)];
  const db = getDb();
  const before = (await tagsForContacts(organizationId, [contactId])).get(contactId) ?? [];
  if (unique.length > 0) {
    const found = await db
      .select({ id: schema.contactTag.id })
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId, inArray(schema.contactTag.id, unique)));
    if (found.length !== unique.length) throw new TagError("not_found", "Alguna etiqueta no existe");
  }
  await db.transaction(async (tx) => {
    // Las etiquetas de SISTEMA no se ven en la interfaz, así que nunca
    // vienen en `tagIds`: se conservan siempre (si no, guardar las visibles
    // borraría el origen de la base).
    await tx
      .delete(schema.contactTagAssignment)
      .where(
        scoped(
          schema.contactTagAssignment.organizationId,
          organizationId,
          eq(schema.contactTagAssignment.contactId, contactId),
          sql`${schema.contactTagAssignment.tagId} not in (
            select ${schema.contactTag.id} from ${schema.contactTag}
            where ${schema.contactTag.organizationId} = ${organizationId}
              and ${schema.contactTag.systemOrigin} is not null
          )`
        )
      );
    if (unique.length > 0) {
      await tx
        .insert(schema.contactTagAssignment)
        .values(unique.map((tagId) => ({ organizationId, contactId, tagId })))
        .onConflictDoNothing();
    }
  });
  const after = (await tagsForContacts(organizationId, [contactId])).get(contactId) ?? [];

  // 022: cada etiqueta puesta o quitada queda en la línea de tiempo.
  const had = new Set(before.map((t) => t.id));
  const has = new Set(after.map((t) => t.id));
  const changes = [
    ...after.filter((t) => !had.has(t.id)).map((t) => ({ kind: "tag_added" as const, tag: t.name })),
    ...before.filter((t) => !has.has(t.id)).map((t) => ({ kind: "tag_removed" as const, tag: t.name })),
  ];
  for (const c of changes) {
    await logActivitySafe({
      organizationId,
      contactId,
      kind: c.kind,
      actorUserId,
      source: actorUserId ? "usuario" : "sistema",
      detail: { tag: c.tag },
    });
  }
  return after;
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

export type MergeResult = {
  /** La etiqueta destino, con su conteo ya actualizado. */
  tag: TagDto;
  /** Contactos que ganaron el destino. */
  moved: number;
  /** Contactos del origen que ya lo tenían (no se duplican). */
  alreadyHad: number;
  /** Bases de Audiencias que pasaron a apuntar al destino. */
  audiences: number;
};

/**
 * Cuánto afecta fusionar `sourceId` en `targetId`, para la confirmación (no
 * escribe nada): contactos que pasarían, cuántos ya la tienen y qué bases de
 * Audiencias pasarían a mostrar el destino.
 */
export async function mergeImpact(
  organizationId: string,
  sourceId: string,
  targetId: string
): Promise<{ source: TagDto; target: TagDto; moved: number; alreadyHad: number; audiences: number }> {
  const db = getDb();
  const tags = await listTags(organizationId, { system: "include" });
  const source = tags.find((t) => t.id === sourceId);
  const target = tags.find((t) => t.id === targetId);
  if (!source || !target) throw new TagError("not_found", "Etiqueta no encontrada");
  if (sourceId === targetId) throw new TagError("invalid", "Elige una etiqueta distinta como destino");
  if (target.system) {
    throw new TagError(
      "system_target",
      `«${target.name}» es una etiqueta automática de importación: no puede ser el destino. Elige una etiqueta normal.`
    );
  }
  const A = schema.contactTagAssignment;
  const [[had], [aud]] = await Promise.all([
    db
      .select({ n: count() })
      .from(A)
      .where(
        scoped(
          A.organizationId,
          organizationId,
          eq(A.tagId, sourceId),
          sql`exists (select 1 from ${A} t2 where t2.organization_id = ${A.organizationId} and t2.contact_id = ${A.contactId} and t2.tag_id = ${targetId})`
        )
      ),
    db
      .select({ n: count() })
      .from(schema.audienceImport)
      .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.tagId, sourceId))),
  ]);
  const all = source.contactCount ?? 0;
  const alreadyHad = Number(had?.n ?? 0);
  return { source, target, moved: all - alreadyHad, alreadyHad, audiences: Number(aud?.n ?? 0) };
}

/**
 * Fusiona `sourceId` EN `targetId`, todo en una transacción: los contactos del
 * origen reciben el destino (sin duplicar), las bases de Audiencias que
 * apuntaban al origen pasan a apuntar al destino (antes de borrarlo: la FK es
 * SET NULL) y el origen desaparece. El destino NO puede ser de sistema. Cada
 * contacto que gana el destino queda en su línea de tiempo.
 */
export async function mergeTags(
  organizationId: string,
  sourceId: string,
  targetId: string,
  actorUserId: string | null = null
): Promise<MergeResult> {
  if (sourceId === targetId) throw new TagError("invalid", "Elige una etiqueta distinta como destino");
  const result = await getDb().transaction(async (tx) => {
    // Las dos filas bloqueadas, en orden estable (dos fusiones cruzadas no se traban).
    const rows = await tx
      .select()
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId, inArray(schema.contactTag.id, [sourceId, targetId])))
      .orderBy(asc(schema.contactTag.id))
      .for("update");
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source || !target) throw new TagError("not_found", "Etiqueta no encontrada");
    if (target.systemOrigin) {
      throw new TagError(
        "system_target",
        `«${target.name}» es una etiqueta automática de importación: no puede ser el destino. Elige una etiqueta normal.`
      );
    }

    const [total] = await tx
      .select({ n: count() })
      .from(schema.contactTagAssignment)
      .where(scoped(schema.contactTagAssignment.organizationId, organizationId, eq(schema.contactTagAssignment.tagId, sourceId)));
    const gained = await tx
      .insert(schema.contactTagAssignment)
      .select(
        tx
          .select({
            organizationId: schema.contactTagAssignment.organizationId,
            contactId: schema.contactTagAssignment.contactId,
            tagId: sql<string>`${targetId}`.as("tag_id"),
            createdAt: sql<Date>`now()`.as("created_at"),
          })
          .from(schema.contactTagAssignment)
          .where(scoped(schema.contactTagAssignment.organizationId, organizationId, eq(schema.contactTagAssignment.tagId, sourceId)))
      )
      .onConflictDoNothing()
      .returning({ contactId: schema.contactTagAssignment.contactId });

    const repointed = await tx
      .update(schema.audienceImport)
      .set({ tagId: targetId })
      .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.tagId, sourceId)))
      .returning({ id: schema.audienceImport.id });

    // Sus asignaciones se van por cascada; los contactos no se tocan.
    await tx
      .delete(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId, eq(schema.contactTag.id, sourceId)));

    await logActivities(
      gained.map((g) => ({
        organizationId,
        contactId: g.contactId,
        kind: "tag_added" as const,
        actorUserId,
        source: actorUserId ? ("usuario" as const) : ("sistema" as const),
        detail: { tag: target.name },
      })),
      tx
    );
    const all = Number(total?.n ?? 0);
    return { target, moved: gained.length, alreadyHad: all - gained.length, audiences: repointed.length };
  });

  const counted = (await listTags(organizationId, { system: "include" })).find((t) => t.id === targetId);
  return {
    tag: counted ?? serializeTag(result.target),
    moved: result.moved,
    alreadyHad: result.alreadyHad,
    audiences: result.audiences,
  };
}
