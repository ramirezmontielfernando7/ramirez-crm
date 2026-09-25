import { asc, eq, inArray, sql } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { scopedContacts } from "@/lib/db/tenant";
import {
  contactFilterConditions,
  contactSearchCondition,
  filterFromSearchParams,
} from "@/server/contact-filter";
import { tagsForContacts } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

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
const EXPORT_MAX = 50_000;

/**
 * 021 — Exporta los contactos a CSV respetando los mismos filtros de la lista
 * (`q`, `stage`, `archived`, `tag`, `source`, `consent`). Sin tope de 200.
 */
export const GET = withAuth(
  async (session, req: Request) => {
    const url = new URL(req.url);
    const filter = filterFromSearchParams(url.searchParams);
    if ("error" in filter) return apiError(422, "invalid_filter", filter.error);
    const q = url.searchParams.get("q")?.trim();
    const stage = url.searchParams.get("stage")?.trim();
    const includeArchived = url.searchParams.get("archived") === "true";

    const db = getDb();
    const leadStages = await db
      .select({ contactId: schema.lead.contactId, stageName: schema.pipelineStage.name })
      .from(schema.lead)
      .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
      .where(scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId));
    const stageByContact = new Map(leadStages.map((r) => [r.contactId, r.stageName]));
    const stageContactIds = stage
      ? leadStages.filter((r) => r.stageName === stage).map((r) => r.contactId)
      : null;

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
                includeArchived ? undefined : sql`${schema.contact.archivedAt} is null`,
                ...contactFilterConditions(filter)
              )
            )
            .orderBy(asc(schema.contact.name))
            .limit(EXPORT_MAX + 1);
    if (rows.length > EXPORT_MAX) {
      return apiError(
        413,
        "too_many",
        `Son más de ${EXPORT_MAX.toLocaleString("es-MX")} contactos: filtra por etiqueta o fuente y exporta por partes`
      );
    }

    // Fuente deducida (018): un contacto sin fuente capturada que llegó por un
    // anuncio se exporta como "anuncio", igual que se ve en la pantalla.
    const ids = rows.map((r) => r.id);
    const tagsByContact = new Map<string, string[]>();
    const porAnuncio = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const tags = await tagsForContacts(session.organizationId, chunk);
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
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="contactos-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
  { permission: "contacts.export" }
);
