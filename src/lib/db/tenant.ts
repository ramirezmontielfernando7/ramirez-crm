import { and, eq, getTableName, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { contact } from "@/lib/db/schema";

/**
 * 026 — "Este contacto lo veo": soy su asignado O participo en su chat
 * (`contact_participant`). UN solo fragmento para todos los filtros de abajo;
 * `alias` es la tabla `contact` de la subconsulta que lo usa.
 * La asignación principal sigue siendo `assigned_user_id`; participar solo
 * suma visibilidad.
 */
function contactVisibleTo(alias: SQL, userId: string): SQL {
  return sql`(${alias}."assigned_user_id" = ${userId} or exists (
    select 1 from "contact_participant" participa
    where participa."contact_id" = ${alias}."id" and participa."user_id" = ${userId}
  ))`;
}

/**
 * Scope de tenant obligatorio (Constitución III).
 *
 * Toda query de dominio se construye con `scoped(...)`: exige el
 * organization_id explícito y lo combina con el resto de condiciones,
 * de modo que un WHERE sin tenant no compile de forma natural.
 */
export function scoped(
  organizationColumn: PgColumn,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  if (!organizationId) {
    throw new Error("scoped(): organizationId vacío — query sin tenant");
  }
  const base = eq(organizationColumn, organizationId);
  const rest = conditions.filter((c): c is SQL => c !== undefined);
  return rest.length > 0 ? and(base, ...rest)! : base;
}

/**
 * 020 — Lo que una sesión puede VER del negocio. Lo arma `requireSession()`
 * a partir del rol (`can(session, "scope.all")`); ningún handler lo construye
 * a mano.
 */
export type Access = {
  organizationId: string;
  userId: string;
  /** true = Propietario/Coordinador: todo el negocio. false = solo lo asignado. */
  seesAll: boolean;
};

/**
 * 020 — Scope de tenant + ASIGNACIÓN, en un solo lugar.
 *
 * Toda consulta de datos de clientes que responde a una persona (chats,
 * mensajes, leads, contactos, citas, resultados) pasa por aquí en vez de por
 * `scoped()`. Para quien ve todo es exactamente `scoped()`; para un asesor
 * añade "el contacto de esta fila está asignado a mí". Funciona con cualquier
 * tabla que tenga `contact_id` (y con `contact.id` mismo), con una subconsulta
 * correlacionada del mismo estilo que `notLabContact`.
 *
 * Un test de vigilancia (`tests/unit/scoped-contacts-guard.test.ts`) falla si
 * una ruta de usuario consulta esas tablas con `scoped()` a secas.
 */
export function scopedContacts(
  organizationColumn: PgColumn,
  access: Access,
  contactIdColumn: PgColumn,
  ...conditions: (SQL | undefined)[]
): SQL {
  return scoped(
    organizationColumn,
    access.organizationId,
    assignedTo(access, contactIdColumn),
    ...conditions
  );
}

/**
 * Solo la condición de asignación (sin tenant), para piezas de SQL que ya
 * llevan su propio `scoped()` — p. ej. las subconsultas de Resultados.
 * `undefined` cuando la sesión ve todo.
 */
export function assignedTo(
  access: Access,
  contactIdColumn: PgColumn
): SQL | undefined {
  if (access.seesAll) return undefined;
  if (!access.userId) {
    throw new Error("assignedTo(): userId vacío — filtro sin dueño");
  }
  // Sobre la propia tabla de contactos la condición es directa: una
  // subconsulta correlacionada con `contact.id` se podría resolver contra su
  // propio alias y dejar pasar todo.
  if (getTableName(contactIdColumn.table) === getTableName(contact)) {
    return or(
      eq(contact.assignedUserId, access.userId),
      sql`exists (
        select 1 from "contact_participant" participa
        where participa."contact_id" = ${contact.id} and participa."user_id" = ${access.userId}
      )`
    )!;
  }
  return sql`exists (
    select 1 from "contact" asignado
    where asignado."id" = ${contactIdColumn}
      and ${contactVisibleTo(sql.raw("asignado"), access.userId)}
  )`;
}

/**
 * 020 — Igual que `scopedContacts` para tablas que cuelgan de una
 * conversación y no de un contacto (`message`, `media_asset`,
 * `offered_slot`): la fila se ve si el contacto de SU conversación se ve.
 */
export function scopedConversations(
  organizationColumn: PgColumn,
  access: Access,
  conversationIdColumn: PgColumn,
  ...conditions: (SQL | undefined)[]
): SQL {
  return scoped(
    organizationColumn,
    access.organizationId,
    conversationAssignedTo(access, conversationIdColumn),
    ...conditions
  );
}

function conversationAssignedTo(
  access: Access,
  conversationIdColumn: PgColumn
): SQL | undefined {
  if (access.seesAll) return undefined;
  if (!access.userId) {
    throw new Error("conversationAssignedTo(): userId vacío — filtro sin dueño");
  }
  return sql`exists (
    select 1 from "conversation" cv_asignada
    join "contact" asignado on asignado."id" = cv_asignada."contact_id"
    where cv_asignada."id" = ${conversationIdColumn}
      and ${contactVisibleTo(sql.raw("asignado"), access.userId)}
  )`;
}

/**
 * 020 — Adjuntos: un archivo no tiene contacto propio; se ve si lo trae un
 * mensaje de una conversación visible o es la imagen del anuncio de origen de
 * un contacto visible.
 */
export function scopedMediaAssets(
  organizationColumn: PgColumn,
  access: Access,
  assetIdColumn: PgColumn,
  ...conditions: (SQL | undefined)[]
): SQL {
  return scoped(
    organizationColumn,
    access.organizationId,
    access.seesAll
      ? undefined
      : sql`(
          exists (
            select 1 from "message" m_adj
            join "conversation" cv_adj on cv_adj."id" = m_adj."conversation_id"
            join "contact" asignado on asignado."id" = cv_adj."contact_id"
            where m_adj."media_asset_id" = ${assetIdColumn}
              and ${contactVisibleTo(sql.raw("asignado"), access.userId)}
          )
          or exists (
            select 1 from "ad_attribution" at_adj
            join "contact" asignado on asignado."id" = at_adj."contact_id"
            where at_adj."image_asset_id" = ${assetIdColumn}
              and ${contactVisibleTo(sql.raw("asignado"), access.userId)}
          )
        )`,
    ...conditions
  );
}
