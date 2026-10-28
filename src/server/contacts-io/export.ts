import { asc, eq, inArray, sql } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { scopedContacts } from "@/lib/db/tenant";
import { contactFilterConditions, contactSearchCondition, type ContactFilter } from "@/server/contact-filter";
import { tagsForContacts } from "@/server/tags/tags";

/**
 * Cabecera del CSV. Las seis primeras son EXACTAMENTE las que entiende la
 * importación: un export se puede volver a importar (p. ej. en otra
 * instancia) sin renombrar columnas. Las demás son informativas y la
 * importación las ignora.
 */
const HEADER = [
  "name",
  "phone",
  "source",
  "waConsent",
  "waConsentSource",
  "tags",
  "stage",
  "archived",
  "createdAt",
];

/** Tope defensivo: más que esto no cabe en una hoja de cálculo útil. */
export const EXPORT_MAX = 50_000;

export type ExportQuery = { q?: string; stage?: string; includeArchived?: boolean; filter: ContactFilter };

/**
 * 021 — Los contactos que ve quien exporta (`scopedContacts`), en CSV, con
 * los mismos filtros de la lista. `max` = cuántos caben (de más: `too_many`).
 * La comparten la ruta de exportar y el conector de IA (047 PR 6).
 */
export async function exportContactsCsv(
  session: Pick<SessionContext, "organizationId" | "access">,
  query: ExportQuery,
  max = EXPORT_MAX
): Promise<{ ok: true; csv: string; count: number } | { ok: false; reason: "too_many"; max: number }> {
  const db = getDb();
  const q = query.q?.trim();
  const stage = query.stage?.trim();
  const leadStages = await db
    .select({ contactId: schema.lead.contactId, stageName: schema.pipelineStage.name })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId));
  const stageByContact = new Map(leadStages.map((r) => [r.contactId, r.stageName]));
  const stageContactIds = stage ? leadStages.filter((r) => r.stageName === stage).map((r) => r.contactId) : null;

  const rows =
    stageContactIds?.length === 0
      ? []
      : await db
          .select()
          .from(schema.contact)
          .where(
            scopedContacts(
              schema.contact.organizationId,
              session.access,
              schema.contact.id,
              contactSearchCondition(q),
              stageContactIds ? inArray(schema.contact.id, stageContactIds) : undefined,
              query.includeArchived ? undefined : sql`${schema.contact.archivedAt} is null`,
              ...contactFilterConditions(query.filter)
            )
          )
          .orderBy(asc(schema.contact.name))
          .limit(max + 1);
  if (rows.length > max) return { ok: false, reason: "too_many", max };

  // Fuente deducida (018): un contacto sin fuente capturada que llegó por un
  // anuncio se exporta como "anuncio", igual que se ve en la pantalla.
  const ids = rows.map((r) => r.id);
  const tagsByContact = new Map<string, string[]>();
  const porAnuncio = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const tags = await tagsForContacts(session.organizationId, chunk, { includeSystem: true });
    for (const [id, list] of tags) tagsByContact.set(id, list.map((t) => t.name));
    const atts = await db
      .select({ contactId: schema.adAttribution.contactId })
      .from(schema.adAttribution)
      .where(
        scopedContacts(
          schema.adAttribution.organizationId,
          session.access,
          schema.adAttribution.contactId,
          inArray(schema.adAttribution.contactId, chunk),
          sql`coalesce(${schema.adAttribution.sourceType}, '') <> 'post'`
        )
      );
    for (const a of atts) if (a.contactId) porAnuncio.add(a.contactId);
  }

  const csv = toCsv(
    HEADER,
    rows.map((c) => [
      c.name,
      c.phone,
      c.source ?? (porAnuncio.has(c.id) ? "anuncio" : ""),
      c.waConsent,
      c.waConsentSource,
      (tagsByContact.get(c.id) ?? []).join(", "),
      stageByContact.get(c.id) ?? "",
      c.archivedAt ? "si" : "",
      c.createdAt.toISOString(),
    ])
  );
  return { ok: true, csv, count: rows.length };
}
