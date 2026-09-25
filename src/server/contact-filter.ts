import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/lib/db";
import { digitsOnly, normalizeText } from "@/lib/search";
import { WA_CONSENT_VALUES, type WaConsent } from "@/lib/tags";
import type { SourceValue } from "@/lib/types";

/**
 * 021 — EL filtro de contactos por etiqueta, fuente y consentimiento.
 *
 * Una sola definición para la lista de Contactos, la exportación a CSV y el
 * público de una campaña: si el usuario filtra "VIP + Anuncio" y exporta, el
 * CSV trae exactamente los que vio; si arma una campaña con ese filtro, el
 * conteo del resumen es exactamente a quién se le envía.
 *
 * Devuelve condiciones SQL sueltas; el scope de tenant/asignación lo pone
 * quien llama (`scopedContacts` o, en campañas, `scoped`).
 */

export const SOURCE_FILTER_VALUES = [
  "anuncio",
  "organico",
  "referido",
  "conocido",
  "otro",
  "desconocida",
] as const;
export type SourceFilter = (typeof SOURCE_FILTER_VALUES)[number];

export type ContactFilter = {
  /** El contacto lleva AL MENOS UNA de estas etiquetas. */
  tagIds?: string[];
  source?: SourceFilter;
  consent?: WaConsent;
};

/** Lee el filtro de la query string (`?tag=a&tag=b&source=…&consent=…`). */
export function filterFromSearchParams(params: URLSearchParams): ContactFilter | { error: string } {
  const tagIds = params
    .getAll("tag")
    .flatMap((t) => t.split(","))
    .map((t) => t.trim())
    .filter(Boolean);
  const source = params.get("source")?.trim() || undefined;
  const consent = params.get("consent")?.trim() || undefined;
  if (source && !(SOURCE_FILTER_VALUES as readonly string[]).includes(source)) {
    return { error: `Fuente no válida: ${source}` };
  }
  if (consent && !(WA_CONSENT_VALUES as readonly string[]).includes(consent)) {
    return { error: `Consentimiento no válido: ${consent}` };
  }
  return {
    tagIds: tagIds.length ? tagIds.slice(0, 50) : undefined,
    source: source as SourceFilter | undefined,
    consent: consent as WaConsent | undefined,
  };
}

/** Mismo filtro, validado desde un body JSON (campañas). */
export const contactFilterSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(50).optional(),
  source: z.enum(SOURCE_FILTER_VALUES).optional(),
  consent: z.enum(WA_CONSENT_VALUES).optional(),
});

/**
 * "Llegó por un anuncio" igual que lo deduce la ficha (018): hay atribución
 * de un anuncio (no de una publicación orgánica) y nadie capturó otra fuente.
 */
function llegoPorAnuncio(): SQL {
  return sql`exists (
    select 1 from "ad_attribution" f_att
    where f_att."contact_id" = ${schema.contact.id}
      and coalesce(f_att."source_type", '') <> 'post'
  )`;
}

export function contactFilterConditions(filter: ContactFilter): SQL[] {
  const out: SQL[] = [];
  if (filter.tagIds && filter.tagIds.length > 0) {
    out.push(sql`exists (
      select 1 from "contact_tag_assignment" f_tag
      where f_tag."contact_id" = ${schema.contact.id}
        and f_tag."tag_id" in (${sql.join(
          filter.tagIds.map((id) => sql`${id}`),
          sql`, `
        )})
    )`);
  }
  if (filter.source) {
    if (filter.source === "anuncio") {
      out.push(
        or(eq(schema.contact.source, "anuncio"), and(isNull(schema.contact.source), llegoPorAnuncio()))!
      );
    } else if (filter.source === "desconocida") {
      out.push(and(isNull(schema.contact.source), sql`not ${llegoPorAnuncio()}`)!);
    } else {
      out.push(eq(schema.contact.source, filter.source as SourceValue));
    }
  }
  if (filter.consent) out.push(eq(schema.contact.waConsent, filter.consent));
  return out;
}

/**
 * Búsqueda tolerante en SQL, espejo de `matchesQuery` del cliente:
 * - nombre sin acentos ni mayúsculas (`translate`, sin depender de la
 *   extensión `unaccent`, que exigiría privilegios en la BD);
 * - teléfono por DÍGITOS, para poder teclearlo como se ve ("+52 462 134…").
 */
const UNACCENT_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
const UNACCENT_TO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

/** Búsqueda por nombre o teléfono (movida aquí desde `GET /api/contacts`). */
export function contactSearchCondition(q: string | undefined): SQL | undefined {
  if (!q || q.length === 0) return undefined;
  const qDigits = digitsOnly(q);
  // El patrón viaja normalizado igual que la columna, y con los comodines de
  // LIKE escapados para que un "%" tecleado no liste todo.
  const qLike = normalizeText(q).replace(/[\\%_]/g, "\\$&");
  return or(
    sql`lower(translate(${schema.contact.name}, ${UNACCENT_FROM}, ${UNACCENT_TO}))
        like ${`%${qLike}%`}`,
    // Un dígito suelto barrería el directorio entero: mínimo 3.
    qDigits.length >= 3
      ? sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '\\D', '', 'g')
            like ${`%${qDigits}%`}`
      : undefined
  );
}
